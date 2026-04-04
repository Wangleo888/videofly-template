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