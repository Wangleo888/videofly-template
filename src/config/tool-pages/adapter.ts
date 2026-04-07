/**
 * 工具页面配置适配器
 *
 * 将 ToolPageConfig 转换为 VideoGeneratorCore 需要的格式
 *
 * @module tool-page-adapter
 */

import type { VideoModel, ImageModel, GeneratorMode } from "@/components/video-generator/types";
import type { VideoGeneratorCoreConfig } from "@/components/video-generator/video-generator-core";
import type { ToolPageConfig } from "@/config/tool-pages/types";
import { CREDITS_CONFIG, getAvailableModels, getAvailableImageModels } from "@/config/credits";

// ============================================================================
// 类型转换函数
// ============================================================================

/**
 * 将 credits.ts 的 ModelConfig 转换为 VideoModel
 */
function convertToVideoModel(modelConfig: any): VideoModel {
  return {
    id: modelConfig.id,
    name: modelConfig.name,
    description: modelConfig.description,
    creditCost: modelConfig.creditCost.base,
    creditDisplay: `${modelConfig.creditCost.base}+`,
    color: getModelColor(modelConfig.id),
    durations: modelConfig.durations?.map((d: number) => `${d}s`),
    aspectRatios: modelConfig.aspectRatios,
    resolutions: modelConfig.qualities,
    supportsAudio: false,
  };
}

/**
 * 将 credits.ts 的 ImageModelConfig 转换为 ImageModel
 */
function convertToImageModel(modelConfig: any): ImageModel {
  return {
    id: modelConfig.id,
    name: modelConfig.name,
    description: modelConfig.description,
    creditCost: modelConfig.creditCost.perImage,
    creditDisplay: `${modelConfig.creditCost.perImage}+`,
    color: getModelColor(modelConfig.id),
  };
}

/**
 * 根据模型 ID 获取品牌颜色
 */
function getModelColor(modelId: string): string {
  const colorMap: Record<string, string> = {
    "sora-2": "#000000",
    "veo-3.1": "#4285f4",
    "wan2.6": "#8b5cf6",
    "seedance-1.5": "#ec4899",
    "seedance-1.5-pro": "#ec4899",
    "kling-2": "#f59e0b",
  };
  return colorMap[modelId] || "#71717a";
}

// ============================================================================
// 适配器函数
// ============================================================================

/**
 * 将 ToolPageConfig 转换为 VideoGeneratorCoreConfig
 *
 * @param toolPageConfig - 工具页面配置
 * @returns VideoGeneratorCore 需要的配置格式
 */
export function adaptToolPageConfigToGeneratorConfig(
  toolPageConfig: ToolPageConfig
): VideoGeneratorCoreConfig {
  const { generator, landing } = toolPageConfig;

  const isImageGeneration = generator.mode === "text-to-image" || generator.mode === "image-to-image";

  // 从 credits.ts 获取所有模型
  const allVideoModels = getAvailableModels();
  const videoModels: VideoModel[] = allVideoModels.map(convertToVideoModel);

  const allImageModels = getAvailableImageModels();
  const imageModels: ImageModel[] = allImageModels.map(convertToImageModel);

  // 根据 generator.models.available 过滤模型
  const availableVideoModels = generator.models.available
    ? videoModels.filter((m) => generator.models.available!.includes(m.id))
    : videoModels;

  const availableImageModels = generator.models.available
    ? imageModels.filter((m) => generator.models.available!.includes(m.id))
    : imageModels;

  // 创建默认模式
  const modeObj: GeneratorMode = {
    id: generator.mode,
    name: getTitleFromMode(generator.mode),
    icon: getIconFromMode(generator.mode),
    uploadType: (generator.mode === "image-to-video" || generator.mode === "image-to-image") ? "single" : undefined,
    supportedModels: generator.models.available,
  };

  const videoModes: GeneratorMode[] = isImageGeneration ? [] : [modeObj];
  const imageModes: GeneratorMode[] = isImageGeneration ? [modeObj] : [];

  // 转换时长、宽高比等配置
  const durations = generator.settings.durations?.map((d) => `${d}s`) ||
    availableVideoModels[0]?.durations ||
    ["5s", "10s", "15s"];

  const defaultAspectRatios = isImageGeneration
    ? (allImageModels.find(m => m.id === (generator.models.default || availableImageModels[0]?.id))?.aspectRatios || ["1:1", "16:9"])
    : (allVideoModels.find(m => m.id === (generator.models.default || availableVideoModels[0]?.id))?.aspectRatios || ["16:9", "9:16", "1:1"]);

  const aspectRatios = generator.settings.aspectRatios || defaultAspectRatios;

  const resolutions = generator.settings.qualities ?? [];

  const outputNumbers = generator.settings.outputNumbers?.map((n) => ({
    value: n,
    isPro: n > 1,
  })) || [
    { value: 1 },
    { value: 2, isPro: true },
    { value: 4, isPro: true },
  ];

  return {
    videoModels: availableVideoModels,
    imageModels: availableImageModels,
    videoModes,
    imageModes,
    imageStyles: [],
    promptTemplates: landing.examples.map((ex, i) => ({
      id: `${i}`,
      text: ex.prompt,
      image: ex.thumbnail,
    })),
    aspectRatios: {
      video: isImageGeneration ? [] : aspectRatios,
      image: isImageGeneration ? aspectRatios : ["1:1", "16:9"],
    },
    durations,
    resolutions,
    outputNumbers: {
      video: outputNumbers,
      image: outputNumbers,
    },
    defaults: {
      generationType: isImageGeneration ? "image" : "video",
      videoModel: isImageGeneration ? undefined : (generator.models.default || generator.models.available?.[0] || availableVideoModels[0]?.id),
      imageModel: isImageGeneration ? (generator.models.default || generator.models.available?.[0] || availableImageModels[0]?.id) : undefined,
      videoMode: isImageGeneration ? undefined : generator.mode,
      imageMode: isImageGeneration ? generator.mode : undefined,
      duration: generator.defaults.duration ? `${generator.defaults.duration}s` : durations[0],
      videoAspectRatio: isImageGeneration ? undefined : (generator.defaults.aspectRatio || aspectRatios[0]),
      imageAspectRatio: isImageGeneration ? (generator.defaults.aspectRatio || aspectRatios[0]) : undefined,
      resolution: resolutions[0],
      videoOutputNumber: isImageGeneration ? undefined : generator.defaults.outputNumber,
      imageOutputNumber: isImageGeneration ? generator.defaults.outputNumber : undefined,
    },
  };
}

/**
 * 根据模式获取标题
 */
function getTitleFromMode(mode: string): string {
  const titles: Record<string, string> = {
    "text-to-video": "Text to Video",
    "image-to-video": "Image to Video",
    "reference-to-video": "Reference to Video",
    "image-to-image": "Image to Image",
    "text-to-image": "Text to Image",
  };
  return titles[mode] || mode;
}

/**
 * 根据模式获取图标类型
 */
function getIconFromMode(mode: string): "text" | "image" | "reference" | "frames" {
  const icons: Record<string, "text" | "image" | "reference" | "frames"> = {
    "text-to-video": "text",
    "image-to-video": "image",
    "reference-to-video": "reference",
    "image-to-image": "image",
    "text-to-image": "text",
  };
  return icons[mode] || "text";
}

// ============================================================================
// 导出
// ============================================================================

export default adaptToolPageConfigToGeneratorConfig;
