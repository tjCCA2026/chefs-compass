
import { GoogleGenAI, Type, Modality, LiveServerMessage } from "@google/genai";
import { CuisineType, DietaryRestriction, TimeConstraint, DishSuggestion, FullRecipe } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const connectCoach = (callbacks: {
  onAudio: (base64: string) => void;
  onInterrupted: () => void;
  onTranscription: (text: string, isInput: boolean) => void;
}) => {
  const ai = getAI();
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks: {
      onopen: () => console.log('Coach is online'),
      onmessage: async (message: LiveServerMessage) => {
        if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
          callbacks.onAudio(message.serverContent.modelTurn.parts[0].inlineData.data);
        }
        if (message.serverContent?.interrupted) {
          callbacks.onInterrupted();
        }
        if (message.serverContent?.inputAudioTranscription) {
          callbacks.onTranscription(message.serverContent.inputAudioTranscription.text, true);
        }
        if (message.serverContent?.outputTranscription) {
          callbacks.onTranscription(message.serverContent.outputTranscription.text, false);
        }
      },
      onerror: (e) => console.error('Coach error:', e),
      onclose: () => console.log('Coach offline'),
    },
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      },
      systemInstruction: `You are "Chef Marco", a world-class culinary coach. 
      Your mission is to help the user decide what to cook, then guide them through preparation.
      Keep your tone encouraging, professional, and concise. 
      If the user is picking a meal, ask clarifying questions about their mood or specific ingredients they have.
      Once a recipe is selected, provide step-by-step guidance.
      Use kitchen metaphors like "Mise en place" or "Let's turn up the heat".`
    },
  });
};

export async function getSuggestions(
  cuisine: CuisineType,
  restrictions: DietaryRestriction,
  time: TimeConstraint
): Promise<DishSuggestion[]> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Suggest 3 appetizing dinner ideas for ${cuisine} cuisine with ${restrictions} dietary restrictions that can be made in ${time}. Focus on flavor and texture.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          dishes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                estimatedTime: { type: Type.STRING },
                difficulty: { type: Type.STRING, enum: ['Easy', 'Medium', 'Hard'] }
              },
              required: ['id', 'name', 'description', 'estimatedTime', 'difficulty']
            }
          }
        },
        required: ['dishes']
      }
    }
  });

  return JSON.parse(response.text || '{"dishes":[]}').dishes;
}

export async function getFullRecipe(dish: DishSuggestion): Promise<FullRecipe> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Plan for "${dish.name}". Description: ${dish.description}. 
    Provide: ingredients (quantities), steps, an image prompt for a 4k food photo, and 3 efficiency coach tips.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
          steps: { type: Type.ARRAY, items: { type: Type.STRING } },
          imagePrompt: { type: Type.STRING },
          coachTips: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['name', 'description', 'ingredients', 'steps', 'imagePrompt', 'coachTips']
      }
    }
  });

  return JSON.parse(response.text || '{}');
}

export async function generateDishImage(prompt: string): Promise<string> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: { parts: [{ text: `Stunning high-end gourmet food photography of ${prompt}, vibrant fresh ingredients, shallow depth of field, warm kitchen lighting, 4k.` }] },
    config: { imageConfig: { aspectRatio: "16:9" } }
  });

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
  }
  return 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=1200&q=80';
}
