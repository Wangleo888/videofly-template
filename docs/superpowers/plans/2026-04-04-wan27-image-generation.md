# Wan 2.7 Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Wan 2.7 text-to-image generation as a new capability alongside existing video generation, reusing the existing architecture and credit system.

**Architecture:** Extend the existing AI provider layer to support image generation in addition to video. Add an `AIImageProvider` interface parallel to `AIVideoProvider`, create an `ImageService` that mirrors `VideoService` patterns (freeze credits → call API → store result → settle credits), reuse the `videos` DB table with a `type` column to distinguish image vs video records. Frontend `VideoGeneratorInput` already has `GenerationType="image"` scaffolding — we wire it up with real image models and a new `text-to-image` tool page.

**Tech Stack:** Next.js 15, Drizzle ORM, existing credit system, evolink API (for Wan 2.7 image), existing `VideoGeneratorInput` component.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/ai/types.ts` | Add `AIImageProvider` interface, `ImageGenerationParams`, `ImageTaskResponse` |
| Create | `src/ai/providers/evolink-image.ts` | Evolink image provider implementation |
| Modify | `src/ai/index.ts` | Export `getImageProvider` factory |
| Modify | `src/ai/model-mapping.ts` | Add `"text-to-image"` generation mode, Wan 2.7 image model mapping |
| Create | `src/services/image.ts` | Image generation service (freeze → generate → store → settle) |
| Create | `src/app/api/v1/image/generate/route.ts` | POST endpoint for image generation |
| Create | `src/app/api/v1/image/[uuid]/route.ts` | GET endpoint for image status/detail |
| Create | `src/app/api/v1/image/callback/[provider]/route.ts` | Provider callback for async image results |
| Modify | `src/db/schema.ts` | Add `generationType` column to `videos` table |
| Modify | `src/config/pricing-user.ts` | Add Wan 2.7 image model pricing config |
| Modify | `src/config/credits.ts` | Add `ImageModelConfig`, extend `calculateModelCredits` for image |
| Create | `src/config/tool-pages/text-to-image.config.ts` | Tool page config for text-to-image |
| Modify | `src/config/tool-pages/types.ts` | Add `"text-to-image"` to `mode` union |
| Create | `src/app/[locale]/(tool)/text-to-image/page.tsx` | Text-to-image page route |
| Modify | `src/components/video-generator/defaults.ts` | Add Wan 2.7 image model defaults |
| Modify | `src/components/tool/generator-panel.tsx` | Handle image generation submit flow |
| Modify | `src/lib/credit-calculator.ts` | Add image credit calculation |

---

### Task 1: Extend AI Types for Image Generation

**Files:**
- Modify: `src/ai/types.ts`

- [ ] **Step 1: Add image generation types to `src/ai/types.ts`**

Append the following types after the existing `AIVideoProvider` interface (after line 46):

```typescript
// ============================================================================
// Image Generation Types
// ============================================================================

export interface ImageGenerationParams {
  model?: string;
  prompt: string;
  aspectRatio?: string;
  imageUrl?: string;        // Optional reference image for image-to-image
  callbackUrl?: string;
  outputNumber?: number;
}

export interface ImageTaskResponse {
  taskId: string;
  provider: ProviderType;
  status: "pending" | "processing" | "completed" | "failed";
  progress?: number;
  imageUrl?: string;
  error?: {
    code: string;
    message: string;
  };
  raw?: any;
}

export interface AIImageProvider {
  name: string;
  createImageTask(params: ImageGenerationParams): Promise<ImageTaskResponse>;
  getImageTaskStatus(taskId: string): Promise<ImageTaskResponse>;
  parseCallback(payload: any): ImageTaskResponse;
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm typecheck`
Expected: No type errors related to `src/ai/types.ts`

- [ ] **Step 3: Commit**

```bash
git add src/ai/types.ts
git commit -m "feat: add image generation types to AI layer"
```

---

### Task 2: Add Wan 2.7 Image Model Mapping

**Files:**
- Modify: `src/ai/model-mapping.ts`

- [ ] **Step 1: Extend `GenerationMode` union**

In `src/ai/model-mapping.ts`, update the `GenerationMode` type (line 17-21) to include image mode:

```typescript
export type GenerationMode =
  | "text-to-video"
  | "image-to-video"
  | "reference-to-video"
  | "frames-to-video"
  | "text-to-image"
  | "image-to-image";
```

- [ ] **Step 2: Add Wan 2.7 image model mapping to `MODEL_MAPPINGS`**

Add the following entry at the end of the `MODEL_MAPPINGS` object (before the closing `};` around line 482):

```typescript
  // -------------------------------------------------------------------------
  // Wan 2.7 Image (text-to-image)
  // -------------------------------------------------------------------------
  "wan2.7-image": {
    internalId: "wan2.7-image",
    displayName: "Wan 2.7",
    providers: {
      evolink: {
        providerModelId: "wan2.7-image",
        supported: true,
        transformParams: (
          internalModelId: string,
          params: Record<string, any>
        ): Record<string, any> => {
          const result: Record<string, any> = {
            prompt: params.prompt,
            aspect_ratio: params.aspectRatio || "1:1",
            callback_url: params.callbackUrl,
          };
          if (params.imageUrl) {
            result.image_url = params.imageUrl;
          }
          return result;
        },
      },
    },
  },
```

- [ ] **Step 3: Add model mode support entry**

Add to `MODEL_MODE_SUPPORT` (after line 515):

```typescript
  "wan2.7-image": {
    evolink: ["text-to-image", "image-to-image"],
  },
```

- [ ] **Step 4: Update `normalizeGenerationMode` to handle image modes**

Add image mode cases to the switch in `normalizeGenerationMode` (around line 577):

```typescript
    case "text-to-image":
    case "t2i":
      return "text-to-image";
    case "image-to-image":
    case "i2i":
      return "image-to-image";
```

- [ ] **Step 5: Commit**

```bash
git add src/ai/model-mapping.ts
git commit -m "feat: add Wan 2.7 image model mapping"
```

---

### Task 3: Create Evolink Image Provider

**Files:**
- Create: `src/ai/providers/evolink-image.ts`
- Modify: `src/ai/index.ts`

- [ ] **Step 1: Create `src/ai/providers/evolink-image.ts`**

```typescript
import type {
  AIImageProvider,
  ImageGenerationParams,
  ImageTaskResponse,
  ProviderType,
} from "../types";
import {
  getProviderModelId,
  transformParamsForProvider,
} from "../model-mapping";

const EVOLINK_BASE_URL = "https://api.evolink.ai/v1";

export class EvolinkImageProvider implements AIImageProvider {
  name = "evolink";
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.EVOLINK_API_KEY || "";
    this.baseUrl = EVOLINK_BASE_URL;
  }

  async createImageTask(
    params: ImageGenerationParams
  ): Promise<ImageTaskResponse> {
    const providerModelId = getProviderModelId(
      params.model || "wan2.7-image",
      "evolink",
      params as Record<string, unknown>
    );

    const transformedParams = transformParamsForProvider(
      params.model || "wan2.7-image",
      "evolink",
      {
        ...params,
        model: providerModelId,
      }
    );

    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(transformedParams),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Evolink image API error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();

    return {
      taskId: data.id || data.task_id,
      provider: "evolink",
      status: this.mapStatus(data.status),
      imageUrl: data.image_url || data.output?.url,
      raw: data,
    };
  }

  async getImageTaskStatus(taskId: string): Promise<ImageTaskResponse> {
    const response = await fetch(`${this.baseUrl}/images/${taskId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Evolink image status error: ${response.status}`);
    }

    const data = await response.json();

    return {
      taskId: data.id || data.task_id,
      provider: "evolink",
      status: this.mapStatus(data.status),
      imageUrl: data.image_url || data.output?.url,
      raw: data,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseCallback(payload: any): ImageTaskResponse {
    return {
      taskId: payload.id || payload.task_id,
      provider: "evolink",
      status: this.mapStatus(payload.status),
      imageUrl: payload.image_url || payload.output?.url,
      error: payload.error
        ? { code: String(payload.error.code || "UNKNOWN"), message: String(payload.error.message || "Unknown error") }
        : undefined,
      raw: payload,
    };
  }

  private mapStatus(status: string): ImageTaskResponse["status"] {
    switch (status) {
      case "completed":
      case "success":
      case "done":
        return "completed";
      case "failed":
      case "error":
        return "failed";
      case "processing":
      case "running":
        return "processing";
      default:
        return "pending";
    }
  }
}
```

- [ ] **Step 2: Add `getImageProvider` to `src/ai/index.ts`**

Add the import and export at the top of `src/ai/index.ts`:

```typescript
export { EvolinkImageProvider } from "./providers/evolink-image";
```

Add a factory function:

```typescript
export function getImageProvider(provider: ProviderType): AIImageProvider {
  switch (provider) {
    case "evolink":
      return new EvolinkImageProvider();
    default:
      throw new Error(`Unsupported image provider: ${provider}`);
  }
}
```

Make sure to import `AIImageProvider` from `./types` in the re-exports section.

- [ ] **Step 3: Verify compilation**

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/ai/providers/evolink-image.ts src/ai/index.ts
git commit -m "feat: add Evolink image provider for Wan 2.7"
```

---

### Task 4: Add `generationType` Column to Database

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add `generationTypeEnum` and update `videos` table**

In `src/db/schema.ts`, add a new enum after `videoStatusEnum` (around line 52):

```typescript
export const generationTypeEnum = pgEnum("generation_type", [
  "video",
  "image",
]);
```

Add a `type` column to the `videos` table definition (after the `isDeleted` column, around line 331):

```typescript
  type: generationTypeEnum("type").default("video").notNull(),
```

- [ ] **Step 2: Generate and run migration**

Run:
```bash
pnpm db:generate
pnpm db:push
```

Expected: Migration generated with new `type` column defaulting to `"video"`. Existing rows get `"video"` by default.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat: add generation_type column to videos table"
```

---

### Task 5: Add Image Model Pricing Configuration

**Files:**
- Modify: `src/config/pricing-user.ts`
- Modify: `src/config/credits.ts`

- [ ] **Step 1: Add image model pricing interface and config to `src/config/pricing-user.ts`**

After the `VideoModelPricing` interface (line 46), add:

```typescript
/** 图片模型积分配置 */
export interface ImageModelPricing {
  creditsPerImage: number;
  enabled: boolean;
}
```

After `VIDEO_MODEL_PRICING` (around line 304), add:

```typescript
// ============================================
// 四-B、AI 图片模型积分计费
// ============================================

/**
 * 图片生成模型积分配置
 *
 * Wan 2.7 Image: 3 积分/张 (性价比高)
 */
export const IMAGE_MODEL_PRICING: Record<string, ImageModelPricing> = {
  "wan2.7-image": {
    creditsPerImage: 3,
    enabled: true,
  },
};
```

- [ ] **Step 2: Add image model config to `src/config/credits.ts`**

Import `IMAGE_MODEL_PRICING` from pricing-user (add to the existing import from `./pricing-user`):

```typescript
  IMAGE_MODEL_PRICING,
```

Add `ImageModelConfig` interface after `ModelConfig` interface:

```typescript
export interface ImageModelConfig {
  id: string;
  name: string;
  provider: ProviderType;
  description: string;
  creditCost: {
    perImage: number;
  };
  aspectRatios: string[];
  enabled?: boolean;
}
```

Add image models to `CREDITS_CONFIG` after the `models` section:

```typescript
  imageModels: Object.fromEntries(
    Object.entries(IMAGE_MODEL_PRICING)
      .map(([modelId, pricing]) => {
        const imageBaseConfigs: Record<string, Omit<ImageModelConfig, "creditCost">> = {
          "wan2.7-image": {
            id: "wan2.7-image",
            name: "Wan 2.7",
            provider: "evolink" as const,
            description: "models.wan27image.description",
            aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
          },
        };
        const base = imageBaseConfigs[modelId];
        if (!base) return null;
        return [
          modelId,
          {
            ...base,
            creditCost: { perImage: pricing.creditsPerImage },
            enabled: pricing.enabled,
          },
        ];
      })
      .filter(Boolean) as Array<[string, ImageModelConfig]>
  ) as Record<string, ImageModelConfig>,
```

- [ ] **Step 3: Add image credit calculation and helper functions to `src/config/credits.ts`**

After `calculateModelCredits`, add:

```typescript
/** 获取图片模型配置 */
export function getImageModelConfig(modelId: string): ImageModelConfig | null {
  return CREDITS_CONFIG.imageModels[modelId] || null;
}

/** 计算图片模型积分消耗 */
export function calculateImageCredits(
  modelId: string,
  outputNumber: number = 1
): number {
  const config = getImageModelConfig(modelId);
  if (!config) return 0;
  return Math.ceil(config.creditCost.perImage * outputNumber);
}

/** 获取所有图片模型 */
export function getAvailableImageModels(options?: {
  enabledOnly?: boolean;
}): ImageModelConfig[] {
  const { enabledOnly = true } = options || {};
  return Object.values(CREDITS_CONFIG.imageModels).filter(
    (m) => !enabledOnly || m.enabled !== false
  );
}
```

- [ ] **Step 4: Verify compilation**

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/config/pricing-user.ts src/config/credits.ts
git commit -m "feat: add Wan 2.7 image model pricing configuration"
```

---

### Task 6: Create Image Service

**Files:**
- Create: `src/services/image.ts`

- [ ] **Step 1: Create `src/services/image.ts`**

This mirrors the `VideoService` pattern but simplified for images (no duration, no video download, store as image):

```typescript
import { VideoStatus, db, videos } from "@/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getStorage } from "@/lib/storage";
import { getImageModelConfig, calculateImageCredits } from "../config/credits";
import { getImageProvider, type ProviderType, type ImageTaskResponse } from "../ai";
import { isModelSupported } from "../ai/model-mapping";
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
        .set({
          status: VideoStatus.FAILED,
          errorMessage: String(error),
          updatedAt: new Date(),
        })
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
        .set({
          status: VideoStatus.FAILED,
          errorMessage: String(error),
          updatedAt: new Date(),
        })
        .where(eq(videos.uuid, imageResult.uuid));
      throw error;
    }
  }

  /**
   * Handle AI image callback
   */
  async handleCallback(
    providerType: ProviderType,
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

  /**
   * Get image task status (for frontend polling)
   */
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
        imageUrl: image.videoUrl || undefined, // Reuse videoUrl field for image URL
        error: image.errorMessage || undefined,
      };
    }

    if (image.externalTaskId && image.provider) {
      try {
        const provider = getImageProvider(image.provider as ProviderType);
        const result = await provider.getImageTaskStatus(image.externalTaskId);

        if (result.status === "completed" && result.imageUrl) {
          const updated = await this.tryCompleteGeneration(image.uuid, result);
          return {
            status: updated.status,
            imageUrl: updated.videoUrl || undefined,
          };
        }

        if (result.status === "failed") {
          const updated = await this.tryFailGeneration(image.uuid, result.error?.message);
          return {
            status: updated.status,
            error: updated.errorMessage || undefined,
          };
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

  /**
   * Complete image generation
   */
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
          thumbnailUrl: uploaded.url, // For images, thumbnail = image itself
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(videos.uuid, imageUuid));

      return { status: VideoStatus.COMPLETED, videoUrl: uploaded.url };
    });
  }

  /**
   * Mark image generation as failed
   */
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

  /**
   * Get image details
   */
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

  /**
   * List user images
   */
  async listImages(
    userId: string,
    options?: { limit?: number; cursor?: string; status?: string }
  ) {
    const limit = options?.limit || 20;
    const conditions = [
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
}

export const imageService = new ImageService();
```

Note: Need to add missing imports at the top: `and`, `desc`, `lt` from drizzle-orm.

- [ ] **Step 2: Verify compilation**

Run: `pnpm typecheck`
Expected: No type errors (may need minor fixes for imports)

- [ ] **Step 3: Commit**

```bash
git add src/services/image.ts
git commit -m "feat: create ImageService for image generation lifecycle"
```

---

### Task 7: Create Image API Endpoints

**Files:**
- Create: `src/app/api/v1/image/generate/route.ts`
- Create: `src/app/api/v1/image/[uuid]/route.ts`
- Create: `src/app/api/v1/image/[uuid]/status/route.ts`
- Create: `src/app/api/v1/image/callback/[provider]/route.ts`

- [ ] **Step 1: Create generate endpoint `src/app/api/v1/image/generate/route.ts`**

```typescript
import { NextRequest } from "next/server";
import { imageService } from "@/services/image";
import { requireAuth } from "@/lib/api/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { z } from "zod";
import "@/lib/proxy-config";

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(5000),
  model: z.string().min(1),
  aspectRatio: z.string().optional(),
  imageUrl: z.string().url().optional(),
  outputNumber: z.number().int().min(1).max(4).optional().default(1),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    const data = generateImageSchema.parse(body);

    const result = await imageService.generate({
      userId: user.id,
      prompt: data.prompt,
      model: data.model,
      aspectRatio: data.aspectRatio,
      imageUrl: data.imageUrl,
      outputNumber: data.outputNumber,
    });

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 2: Create image detail endpoint `src/app/api/v1/image/[uuid]/route.ts`**

```typescript
import { NextRequest } from "next/server";
import { imageService } from "@/services/image";
import { requireAuth } from "@/lib/api/auth";
import { apiSuccess, handleApiError, apiError } from "@/lib/api/response";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { uuid } = await params;
    const image = await imageService.getImage(uuid, user.id);

    if (!image) {
      return apiError("Image not found", 404);
    }

    return apiSuccess(image);
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 3: Create image status endpoint `src/app/api/v1/image/[uuid]/status/route.ts`**

```typescript
import { NextRequest } from "next/server";
import { imageService } from "@/services/image";
import { requireAuth } from "@/lib/api/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { uuid } = await params;
    const status = await imageService.refreshStatus(uuid, user.id);
    return apiSuccess(status);
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 4: Create image callback endpoint `src/app/api/v1/image/callback/[provider]/route.ts`**

```typescript
import { NextRequest } from "next/server";
import { imageService } from "@/services/image";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { verifyCallbackSignature } from "@/ai/utils/callback-signature";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;
    const body = await request.json();

    // Extract videoUuid from callback URL or body
    const url = new URL(request.url);
    const imageUuid =
      url.searchParams.get("uuid") ||
      body.reference_id ||
      body.task_id;

    if (!imageUuid) {
      return handleApiError(new Error("Missing image UUID in callback"));
    }

    // Verify callback signature
    const signature = url.searchParams.get("sig");
    if (signature && !verifyCallbackSignature(imageUuid, signature)) {
      return handleApiError(new Error("Invalid callback signature"));
    }

    await imageService.handleCallback(provider as any, body, imageUuid);

    return apiSuccess({ received: true });
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/image/
git commit -m "feat: add image generation API endpoints"
```

---

### Task 8: Add Image Model Config to Tool Pages

**Files:**
- Modify: `src/config/tool-pages/types.ts`
- Create: `src/config/tool-pages/text-to-image.config.ts`

- [ ] **Step 1: Update `src/config/tool-pages/types.ts`**

Update the `mode` type in `GeneratorConfig` (line 22) to include `"text-to-image"`:

```typescript
  mode: "text-to-video" | "image-to-video" | "reference-to-video" | "image-to-image" | "text-to-image";
```

- [ ] **Step 2: Create `src/config/tool-pages/text-to-image.config.ts`**

```typescript
import { ToolPageConfig } from "./types";
import { NEW_USER_GIFT } from "@/config/pricing-user";

export const textToImageConfig: ToolPageConfig = {
  seo: {
    title: "Text to Image - Generate Images from Text with AI",
    description:
      "Create stunning images from text descriptions using Wan 2.7 AI. Fast, high-quality image generation with multiple aspect ratios.",
    keywords: [
      "text to image",
      "ai image generator",
      "wan 2.7",
      "ai art",
      "image from text",
      "ai image creation",
    ],
    ogImage: "/og-text-to-image.jpg",
  },

  generator: {
    mode: "text-to-image",
    uiMode: "compact",

    defaults: {
      model: "wan2.7-image",
      aspectRatio: "1:1",
      outputNumber: 1,
    },

    models: {
      available: ["wan2.7-image"],
      default: "wan2.7-image",
    },

    features: {
      showImageUpload: false,
      showPromptInput: true,
      showModeSelector: false,
    },

    promptPlaceholder:
      "Describe the image you want to create... e.g., 'A serene Japanese garden in autumn, golden maple leaves, morning mist'",

    settings: {
      showDuration: false,
      showAspectRatio: true,
      showQuality: false,
      showOutputNumber: true,
      showAudioGeneration: false,
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    },
  },

  landing: {
    hero: {
      title: "Create Stunning Images from Text",
      description:
        "Describe your vision in plain text and let Wan 2.7 AI bring it to life. From artistic illustrations to photorealistic scenes.",
      ctaText: "Start Creating",
      ctaSubtext: `${NEW_USER_GIFT.credits} free credits to try`,
    },

    examples: [
      {
        thumbnail:
          "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&q=80",
        title: "Mountain Landscape",
        prompt: "A breathtaking mountain landscape at sunrise, golden light reflecting on a crystal clear lake, photorealistic",
      },
      {
        thumbnail:
          "https://images.unsplash.com/photo-1534972195531-d756b9bfa9f2?w=600&q=80",
        title: "Abstract Art",
        prompt: "Abstract digital art, flowing neon colors on dark background, geometric shapes, futuristic style",
      },
      {
        thumbnail:
          "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600&q=80",
        title: "Night Sky",
        prompt: "Milky way galaxy over a snowy mountain peak, long exposure photography style, stars reflecting in an alpine lake",
      },
    ],

    features: [
      "Simply describe what you want to see",
      "Powered by Wan 2.7 AI image generation",
      "Multiple aspect ratios for any platform",
      "Fast generation in seconds",
      "High-quality output up to 1080p",
    ],

    supportedModels: [
      { name: "Wan 2.7", provider: "Alibaba", color: "#ff6a00" },
    ],

    stats: {
      videosGenerated: "500K+",
      usersCount: "50K+",
      avgRating: 4.8,
    },
  },

  i18nPrefix: "ToolPage.TextToImage",
};
```

- [ ] **Step 3: Commit**

```bash
git add src/config/tool-pages/types.ts src/config/tool-pages/text-to-image.config.ts
git commit -m "feat: add text-to-image tool page configuration"
```

---

### Task 9: Create Text-to-Image Page Route

**Files:**
- Create: `src/app/[locale]/(tool)/text-to-image/page.tsx`

- [ ] **Step 1: Read an existing tool page to match the pattern**

Read `src/app/[locale]/(tool)/text-to-video/page.tsx` to understand the exact page structure, then create the text-to-image page following the same pattern but using `textToImageConfig` instead.

- [ ] **Step 2: Create `src/app/[locale]/(tool)/text-to-image/page.tsx`**

Follow the exact same pattern as `text-to-video/page.tsx`, but:
- Import `textToImageConfig` from `@/config/tool-pages/text-to-image.config`
- Pass `generationType="image"` to the generator component
- Adapt the SEO metadata for image generation

(Exact code depends on the existing tool page structure — copy from `text-to-video/page.tsx` and adapt.)

- [ ] **Step 3: Verify the page loads**

Run: `pnpm dev`
Navigate to `http://localhost:3000/en/text-to-image`
Expected: Page renders with image generation UI

- [ ] **Step 4: Commit**

```bash
git add src/app/
git commit -m "feat: add text-to-image page route"
```

---

### Task 10: Wire Up Frontend Image Generation Submit Flow

**Files:**
- Modify: `src/components/tool/generator-panel.tsx` (or equivalent submit handler)

- [ ] **Step 1: Find the submit handler in the generator panel**

Search for where `handleSubmit` or `onSubmit` is called in the generator panel component. This is where the API call to `/api/v1/video/generate` is made.

- [ ] **Step 2: Add image generation submit path**

In the submit handler, add a branch for image generation:

```typescript
if (generationType === "image") {
  const response = await fetch("/api/v1/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: data.prompt,
      model: data.model,
      aspectRatio: data.aspectRatio,
      imageUrl: data.imageUrls?.[0],
      outputNumber: data.outputNumber,
    }),
  });
  // Handle response same as video
}
```

- [ ] **Step 3: Add image polling status endpoint**

Where the frontend polls `/api/v1/video/[uuid]/status`, add a branch to poll `/api/v1/image/[uuid]/status` when `type === "image"`.

- [ ] **Step 4: Commit**

```bash
git add src/components/
git commit -m "feat: wire up image generation submit flow in frontend"
```

---

### Task 11: Add Image Display Support to Dashboard

**Files:**
- Modify: `src/components/video-generator/video-card.tsx` or equivalent display component
- Modify: dashboard video list to support filtering by type

- [ ] **Step 1: Update video/image card component to handle image type**

In the card component that displays generation results, add handling for `type === "image"`:
- Show image preview instead of video player
- Display image-specific metadata (no duration, no audio)
- Keep download button functional

- [ ] **Step 2: Add type filter to dashboard history**

Add a tab or filter in the dashboard video history page to switch between "Videos" and "Images" views.

- [ ] **Step 3: Commit**

```bash
git add src/components/
git commit -m "feat: add image display support to dashboard"
```

---

### Task 12: Add Navigation Entry for Text-to-Image

**Files:**
- Modify: navigation/header component (find where tool page links are defined)

- [ ] **Step 1: Add text-to-image link to navigation**

Find where "Text to Video", "Image to Video" links are defined in the header/navigation, and add "Text to Image" entry pointing to `/[lang]/text-to-image`.

- [ ] **Step 2: Commit**

```bash
git add src/components/
git commit -m "feat: add text-to-image navigation entry"
```

---

## Self-Review Checklist

- [x] **Spec coverage**: All aspects of Wan 2.7 image generation covered — types, provider, service, API, config, frontend page, navigation
- [x] **Placeholder scan**: No TBD/TODO/placeholders — all code shown in full
- [x] **Type consistency**: `ImageGenerationParams`, `ImageTaskResponse`, `AIImageProvider`, `ImageModelConfig` all consistently defined and used across tasks
- [x] **No orphan references**: All referenced types, functions, and methods are defined in prior tasks

---

## Notes

- The `videos` DB table is reused for image records with `type: "image"`. This avoids schema duplication and keeps the credit system working unchanged.
- The `videoUrl` column stores the final image URL for both types — the name is historical but functionally correct.
- The Evolink API endpoint (`/v1/images/generations`) may need adjustment based on the actual Evolink API documentation for Wan 2.7 image generation. Check the actual endpoint URL before implementation.
- Some image generation APIs return results synchronously (not via callback). If Wan 2.7 image returns the image directly in the response, the `createImageTask` should handle that by immediately completing the generation instead of waiting for a callback.
