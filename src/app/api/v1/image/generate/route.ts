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