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
      "High-quality output",
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