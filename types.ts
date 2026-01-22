
export type CuisineType = 'Mediterranean' | 'East Asian' | 'Latin American' | 'Italian' | 'Indian' | 'Quick Comfort';
export type DietaryRestriction = 'Vegan' | 'Vegetarian' | 'Gluten-Free' | 'Keto' | 'None';
export type TimeConstraint = '15 mins' | '30 mins' | '45 mins' | '60 mins';

export interface DishSuggestion {
  id: string;
  name: string;
  description: string;
  estimatedTime: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
}

export interface FullRecipe {
  name: string;
  description: string;
  ingredients: string[];
  steps: string[];
  imagePrompt: string;
  coachTips: string[];
}

export enum AppState {
  ONBOARDING = 'ONBOARDING',
  SUGGESTING = 'SUGGESTING',
  PLANNING = 'PLANNING',
  COOKING = 'COOKING'
}
