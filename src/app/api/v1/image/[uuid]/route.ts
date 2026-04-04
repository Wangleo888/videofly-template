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