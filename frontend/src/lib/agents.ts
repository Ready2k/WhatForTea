/**
 * Strict AgentState interfaces as per Section 11.1 of SPEC_V2.md.
 * These MUST mirror the Python TypedDicts in backend/app/agents/ field-for-field.
 */

import type { A2UIDescriptor } from './a2ui';
import type { PantryItem } from './types';

export type { A2UIDescriptor };  // re-export so existing imports from agents.ts keep working

export type HITLStatus = 'idle' | 'waiting' | 'applied' | 'rejected';

export interface TeaBotAgentState {
  // messages: any[]; // Omitted from TS if not needed by widgets
  hitl_status: HITLStatus;
  a2ui: A2UIDescriptor[];
  error: string | null;
}

export interface PendingUpsert {
  raw_name: string;
  quantity: number;
  unit: string | null;
  ingredient_id: string | null;
}

export interface PantryAgentState {
  items: PantryItem[];
  pending_upsert: PendingUpsert | null;
  hitl_status: HITLStatus;
  a2ui: A2UIDescriptor[];
  error: string | null;
}

export interface RecipeAgentState {
  messages?: any[];
  recipes: any[]; // Serialized RecipeMatchResult
  hitl_status: HITLStatus;
  a2ui: A2UIDescriptor[];
  error: string | null;
}

export interface PlannerAgentState {
  messages?: any[];
  week_start: string; // YYYY-MM-DD
  plan_entries: any[];
  shopping_list: any | null;
  hitl_status: HITLStatus;
  a2ui: A2UIDescriptor[];
  error: string | null;
}

export interface CookingAgentState {
  messages?: any[];
  session_id: string | null;
  recipe_title: string | null;
  current_step: number;
  total_steps: number;
  completed_steps: number[];
  step_text: string | null;
  hitl_status: HITLStatus;
  a2ui: A2UIDescriptor[];
  error: string | null;
}

export interface IngestAgentState {
  messages?: any[];
  job_id: string | null;
  source_url: string | null;
  parsed_recipe: any | null;
  hitl_status: HITLStatus;
  a2ui: A2UIDescriptor[];
  error: string | null;
}


