import { VideoStatus, db, videos } from "@/db";
import { and, desc, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getStorage } from "@/lib/storage";
import { getImageModelConfig, calculateImageCredits } from "@/config/credits";
import { getImageProvider, type ProviderType, type ImageTaskResponse } from "@/ai";
import { isModelSupported } from "@/ai/model-mapping";
import { creditService } from "./credit";
import { generateSignedCallbackUrl } from "@/ai/utils/callback-signature";
import { ApiError } from "@/lib/api/error";
import { getConfiguredAIProvider } from "@/ai/provider-config";

export interface GenerateImageParams {
  userId: string;
  prompt: string;
  model: string;
  aspectRatio?: string;
  imageUrl?: string;
  outputNumber?: number;
}

export interface ImageGenerationResult {
  imageUuid: string;
  taskId: string;
  provider: ProviderType;
  status: string;
  creditsUsed: number;
}

export class ImageService {
  private callbackBaseUrl: string;

  constructor() {
    this.callbackBaseUrl = process.env.AI_CALLBACK_URL || "";
  }

  async generate(params: GenerateImageParams): Promise<ImageGenerationResult> {
    const modelConfig = getImageModelConfig(params.model);
    if (!modelConfig) {
      throw new ApiError(`Unsupported image model: ${params.model}`, 400, {
        code: "UNSUPPORTED_MODEL",
        model: params.model,
      });
    }

    const outputNumber = Math.max(1, params.outputNumber ?? 1);
    const creditsRequired = calculateImageCredits(params.model, outputNumber);

    const configuredProvider = getConfiguredAIProvider();
    if (configuredProvider && !isModelSupported(params.model, configuredProvider)) {
      throw new ApiError(
        `Model ${params.model} is not available for provider ${configuredProvider}`,
        400,
        { code: "MODEL_NOT_AVAILABLE_FOR_PROVIDER", model: params.model, provider: configuredProvider }
      );
    }

    const actualProvider = configuredProvider || modelConfig.provider;
    const imageUuid = `img_${nanoid(21)}`;

    const [imageResult] = await db
      .insert(videos)
      .values({
        uuid: imageUuid,
        userId: params.userId,
        prompt: params.prompt,
        model: params.model,
        type: "image",
        parameters: {
          aspectRatio: params.aspectRatio,
          outputNumber,
          imageUrl: params.imageUrl,
        },
        status: VideoStatus.PENDING,
        startImageUrl: params.imageUrl || null,
        creditsUsed: creditsRequired,
        aspectRatio: params.aspectRatio || null,
        provider: actualProvider,
        updatedAt: new Date(),
      })
      .returning({ uuid: videos.uuid, id: videos.id });

    if (!imageResult) {
      throw new Error("Failed to create image record");
    }

    let freezeResult: { success: boolean; holdId: number };
    try {
      freezeResult = await creditService.freeze({
        userId: params.userId,
        credits: creditsRequired,
        videoUuid: imageResult.uuid,
      });
    } catch (error) {
      await db
        .update(videos)
        .set({ status: VideoStatus.FAILED, errorMessage: String(error), updatedAt: new Date() })
        .where(eq(videos.uuid, imageResult.uuid));
      throw error;
    }

    if (!freezeResult.success) {
      await db
        .update(videos)
        .set({
          status: VideoStatus.FAILED,
          errorMessage: `Insufficient credits. Required: ${creditsRequired}`,
          updatedAt: new Date(),
        })
        .where(eq(videos.uuid, imageResult.uuid));
      throw new ApiError("Insufficient credits", 402, {
        code: "INSUFFICIENT_CREDITS",
        requiredCredits: creditsRequired,
      });
    }

    const provider = getImageProvider(actualProvider);

    const callbackUrl = this.callbackBaseUrl
      ? generateSignedCallbackUrl(
          `${this.callbackBaseUrl}/image/${actualProvider}`,
          imageResult.uuid
        )
      : undefined;

    try {
      const result = await provider.createImageTask({
        model: params.model,
        prompt: params.prompt,
        aspectRatio: params.aspectRatio,
        imageUrl: params.imageUrl,
        outputNumber,
        callbackUrl,
      });

      await db
        .update(videos)
        .set({
          status: VideoStatus.GENERATING,
          externalTaskId: result.taskId,
          provider: actualProvider,
          updatedAt: new Date(),
        })
        .where(eq(videos.uuid, imageResult.uuid));

      return {
        imageUuid: imageResult.uuid,
        taskId: result.taskId,
        provider: actualProvider,
        status: "GENERATING",
        creditsUsed: creditsRequired,
      };
    } catch (error) {
      await creditService.release(imageResult.uuid);
      await db
        .update(videos)
        .set({ status: VideoStatus.FAILED, errorMessage: String(error), updatedAt: new Date() })
        .where(eq(videos.uuid, imageResult.uuid));
      throw error;
    }
  }

  async handleCallback(
    providerType: ProviderType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any,
    imageUuid: string
  ): Promise<void> {
    const provider = getImageProvider(providerType);
    const result = provider.parseCallback(payload);

    const [image] = await db
      .select()
      .from(videos)
      .where(eq(videos.uuid, imageUuid))
      .limit(1);

    if (!image) {
      console.error(`Image not found: ${imageUuid}`);
      return;
    }

    if (result.status === "completed" && result.imageUrl) {
      await this.tryCompleteGeneration(image.uuid, result);
    } else if (result.status === "failed") {
      await this.tryFailGeneration(image.uuid, result.error?.message);
    }
  }

  async refreshStatus(
    imageUuid: string,
    userId: string
  ): Promise<{ status: string; imageUrl?: string; error?: string }> {
    const [image] = await db
      .select()
      .from(videos)
      .where(and(eq(videos.uuid, imageUuid), eq(videos.userId, userId)))
      .limit(1);

    if (!image) {
      throw new Error("Image not found");
    }

    if (image.status === VideoStatus.COMPLETED || image.status === VideoStatus.FAILED) {
      return {
        status: image.status,
        imageUrl: image.videoUrl || undefined,
        error: image.errorMessage || undefined,
      };
    }

    if (image.externalTaskId && image.provider) {
      try {
        const provider = getImageProvider(image.provider as ProviderType);
        const result = await provider.getImageTaskStatus(image.externalTaskId);

        if (result.status === "completed" && result.imageUrl) {
          const updated = await this.tryCompleteGeneration(image.uuid, result);
          return { status: updated.status, imageUrl: updated.videoUrl || undefined };
        }

        if (result.status === "failed") {
          const updated = await this.tryFailGeneration(image.uuid, result.error?.message);
          return { status: updated.status, error: updated.errorMessage || undefined };
        }

        if (result.status === "processing" && image.status === VideoStatus.PENDING) {
          await db
            .update(videos)
            .set({ status: VideoStatus.GENERATING, updatedAt: new Date() })
            .where(eq(videos.uuid, image.uuid));
          return { status: VideoStatus.GENERATING };
        }
      } catch (error) {
        console.error("Failed to refresh image status from provider:", error);
      }
    }

    return { status: image.status };
  }

  async tryCompleteGeneration(
    imageUuid: string,
    result: ImageTaskResponse
  ): Promise<{ status: string; videoUrl?: string | null }> {
    return db.transaction(async (trx) => {
      const [image] = await trx
        .select()
        .from(videos)
        .where(eq(videos.uuid, imageUuid))
        .limit(1);

      if (!image) throw new Error("Image not found");
      if (image.status === VideoStatus.COMPLETED) {
        return { status: image.status, videoUrl: image.videoUrl };
      }
      if (image.status === VideoStatus.FAILED) {
        return { status: image.status, videoUrl: null };
      }

      await trx
        .update(videos)
        .set({
          status: VideoStatus.UPLOADING,
          originalVideoUrl: result.imageUrl,
          updatedAt: new Date(),
        })
        .where(eq(videos.uuid, imageUuid));

      const storage = getStorage();
      const key = `images/${imageUuid}/${Date.now()}.png`;
      const uploaded = await storage.downloadAndUpload({
        sourceUrl: result.imageUrl!,
        key,
        contentType: "image/png",
      });

      await creditService.settle(imageUuid);

      await trx
        .update(videos)
        .set({
          status: VideoStatus.COMPLETED,
          videoUrl: uploaded.url,
          thumbnailUrl: uploaded.url,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(videos.uuid, imageUuid));

      return { status: VideoStatus.COMPLETED, videoUrl: uploaded.url };
    });
  }

  private async tryFailGeneration(
    imageUuid: string,
    errorMessage?: string
  ): Promise<{ status: string; errorMessage?: string | null }> {
    return db.transaction(async (trx) => {
      const [image] = await trx
        .select()
        .from(videos)
        .where(eq(videos.uuid, imageUuid))
        .limit(1);

      if (!image) throw new Error("Image not found");
      if (image.status === VideoStatus.COMPLETED || image.status === VideoStatus.FAILED) {
        return { status: image.status, errorMessage: image.errorMessage };
      }

      await creditService.release(imageUuid);

      await trx
        .update(videos)
        .set({
          status: VideoStatus.FAILED,
          errorMessage: errorMessage || "Image generation failed",
          updatedAt: new Date(),
        })
        .where(eq(videos.uuid, imageUuid));

      return {
        status: VideoStatus.FAILED,
        errorMessage: errorMessage || "Image generation failed",
      };
    });
  }

  async getImage(uuid: string, userId: string) {
    const [image] = await db
      .select()
      .from(videos)
      .where(
        and(eq(videos.uuid, uuid), eq(videos.userId, userId), eq(videos.isDeleted, false))
      )
      .limit(1);
    return image ?? null;
  }

  async listImages(
    userId: string,
    options?: { limit?: number; cursor?: string; status?: string }
  ) {
    const limit = options?.limit || 20;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conditions: any[] = [
      eq(videos.userId, userId),
      eq(videos.isDeleted, false),
      eq(videos.type, "image"),
    ];

    if (options?.status) {
      conditions.push(eq(videos.status, options.status as any));
    }

    if (options?.cursor) {
      const [cursorImage] = await db
        .select({ createdAt: videos.createdAt })
        .from(videos)
        .where(eq(videos.uuid, options.cursor))
        .limit(1);
      if (cursorImage) {
        conditions.push(lt(videos.createdAt, cursorImage.createdAt));
      }
    }

    const list = await db
      .select()
      .from(videos)
      .where(and(...conditions))
      .orderBy(desc(videos.createdAt))
      .limit(limit + 1);

    const hasMore = list.length > limit;
    if (hasMore) list.pop();

    return {
      images: list,
      nextCursor: hasMore ? list[list.length - 1]?.uuid : undefined,
    };
  }

  async deleteImage(uuid: string, userId: string): Promise<void> {
    await db
      .update(videos)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(eq(videos.uuid, uuid), eq(videos.userId, userId)));
  }
}

export const imageService = new ImageService();
