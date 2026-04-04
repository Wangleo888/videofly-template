import type {
  AIImageProvider,
  ImageGenerationParams,
  ImageTaskResponse,
} from "../types";

export class EvolinkImageProvider implements AIImageProvider {
  name = "evolink";
  private apiKey: string;
  private baseUrl = "https://api.evolink.ai/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createImageTask(
    params: ImageGenerationParams
  ): Promise<ImageTaskResponse> {
    const requestBody: Record<string, unknown> = {
      prompt: params.prompt,
      model: params.model || "wan2.7-image",
      aspect_ratio: params.aspectRatio || "1:1",
      callback_url: params.callbackUrl,
    };

    if (params.imageUrl) {
      requestBody.image_url = params.imageUrl;
    }

    if (params.outputNumber) {
      requestBody.n = params.outputNumber;
    }

    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let errorMessage = `API error: ${response.status}`;
      try {
        const error = await response.json();
        errorMessage =
          error.error?.message || error.message || errorMessage;
      } catch {
        errorMessage = response.statusText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    return {
      taskId: data.id || data.task_id,
      provider: "evolink",
      status: this.mapStatus(data.status),
      imageUrl: this.extractImageUrl(data),
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
      const errorText = await response.text();
      if (response.status === 404 || response.status === 410) {
        return {
          taskId,
          provider: "evolink",
          status: "failed",
          error: {
            code: "TASK_NOT_FOUND",
            message: errorText || "Task not found or expired",
          },
        };
      }
      if (response.status === 429) {
        throw new Error(
          `Rate limit exceeded. Please retry later. ${errorText}`
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Authentication failed. Check your API key. ${errorText}`
        );
      }
      throw new Error(
        `Failed to get image task status (${response.status}): ${errorText}`
      );
    }

    const data = await response.json();

    return {
      taskId: data.id || data.task_id,
      provider: "evolink",
      status: this.mapStatus(data.status),
      imageUrl: this.extractImageUrl(data),
      raw: data,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseCallback(payload: any): ImageTaskResponse {
    return {
      taskId: payload.id || payload.task_id,
      provider: "evolink",
      status: this.mapStatus(payload.status),
      imageUrl: this.extractImageUrl(payload),
      error: payload.error
        ? {
            code: String(payload.error.code || "UNKNOWN"),
            message: String(payload.error.message || "Unknown error"),
          }
        : undefined,
      raw: payload,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractImageUrl(data: any): string | undefined {
    if (data.image_url) return data.image_url;
    if (data.output?.url) return data.output.url;
    if (data.data?.image_url) return data.data.image_url;
    if (Array.isArray(data.results) && data.results.length > 0) {
      return typeof data.results[0] === "string"
        ? data.results[0]
        : data.results[0]?.url;
    }
    return undefined;
  }

  private mapStatus(status: string): ImageTaskResponse["status"] {
    const map: Record<string, ImageTaskResponse["status"]> = {
      pending: "pending",
      processing: "processing",
      completed: "completed",
      success: "completed",
      done: "completed",
      failed: "failed",
      error: "failed",
      cancelled: "failed",
    };
    return map[status] || "pending";
  }
}
