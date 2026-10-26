import { z } from "zod";
export const discoveryInput = z.object({context:z.string().trim().max(4000),skills:z.string().trim().max(300),query:z.string().trim().max(200)}).refine(v=>Boolean(v.context||v.skills||v.query),"Describe the opportunity or skills you need.");
export const criterionSchema = z.object({text:z.string().min(1).max(300),importance:z.enum(["required","requested","context"])});
export const criteriaSchema = z.array(criterionSchema).min(1).max(6);
export const matchSchema = z.object({criterion:criterionSchema,status:z.enum(["supported","partial","unknown","contradicted"])});
export type DiscoveryCriterion = z.infer<typeof criterionSchema>;
export type DiscoveryMatch = z.infer<typeof matchSchema>;
