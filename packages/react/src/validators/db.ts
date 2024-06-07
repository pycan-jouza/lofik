import { z } from "zod";
import { DatabaseMutationOperation } from "../types";

const generateDatabaseMutationBaseSchema = z.object({
  tableName: z.string(),
  identifierColumn: z.string().optional(),
});

export const generateDatabaseUpsertSchema =
  generateDatabaseMutationBaseSchema.extend({
    operation: z.literal(DatabaseMutationOperation.Upsert),
    columnDataMap: z.record(z.unknown()),
  });

export const generateDatabaseDeleteSchema =
  generateDatabaseMutationBaseSchema.extend({
    operation: z.literal(DatabaseMutationOperation.Delete),
    identifierValue: z.union([z.number(), z.string()]),
  });

export const generateDatabaseMutationSchema = z.union([
  generateDatabaseUpsertSchema,
  generateDatabaseDeleteSchema,
]);
