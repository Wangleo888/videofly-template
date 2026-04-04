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

    const url = new URL(request.url);
    const imageUuid =
      url.searchParams.get("uuid") ||
      body.reference_id ||
      body.task_id;

    if (!imageUuid) {
      return handleApiError(new Error("Missing image UUID in callback"));
    }

    const timestamp = url.searchParams.get("ts");
    const signature = url.searchParams.get("sig");
    if (timestamp && signature && !verifyCallbackSignature(imageUuid, timestamp, signature)) {
      return handleApiError(new Error("Invalid callback signature"));
    }

    await imageService.handleCallback(provider as any, body, imageUuid);

    return apiSuccess({ received: true });
  } catch (error) {
    return handleApiError(error);
  }
}