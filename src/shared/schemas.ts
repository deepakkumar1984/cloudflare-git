import { z } from "zod";
import {
  GIT_PROVIDERS,
  ISSUE_STATES,
  MAX_BODY_LENGTH,
  MAX_IMPORT_DEPTH,
  MAX_PAGE_SIZE,
  MAX_PROVIDER_REPO_SEGMENTS,
  MAX_TITLE_LENGTH,
  RESERVED_SLUGS,
  ROLES,
  SLUG_RE,
  VISIBILITIES,
} from "./constants";

export const roleSchema = z.enum(ROLES);
export const visibilitySchema = z.enum(VISIBILITIES);
export const issueStateSchema = z.enum(ISSUE_STATES);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Must be at least 2 characters")
  .max(63, "Must be at most 63 characters")
  .regex(SLUG_RE, "Use lowercase letters, numbers, and hyphens")
  .refine((value) => !RESERVED_SLUGS.has(value), "This path is reserved");

export const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required")
  .max(
    MAX_TITLE_LENGTH,
    `Title must be at most ${MAX_TITLE_LENGTH} characters`
  );

export const bodySchema = z
  .string()
  .max(MAX_BODY_LENGTH, `Body must be at most ${MAX_BODY_LENGTH} characters`)
  .default("");

export const optionalBodySchema = z
  .string()
  .max(MAX_BODY_LENGTH, `Body must be at most ${MAX_BODY_LENGTH} characters`)
  .optional();

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color");

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .nullable()
  .optional();

export const idSchema = z.string().uuid();

export const groupCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2_000).optional().default(""),
  visibility: visibilitySchema.optional().default("private"),
});

export const groupUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(2_000).optional(),
  visibility: visibilitySchema.optional(),
});

export const projectCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2_000).optional().default(""),
  visibility: visibilitySchema.optional().default("private"),
  defaultBranch: z.string().trim().min(1).max(255).optional().default("main"),
});

export const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(2_000).optional(),
  visibility: visibilitySchema.optional(),
  defaultBranch: z.string().trim().min(1).max(255).optional(),
});

export const gitProviderSchema = z.enum(GIT_PROVIDERS);

const branchSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.includes("..") &&
      !value.includes("@{") &&
      !value.includes("\\") &&
      // oxlint-disable-next-line no-control-regex -- Git ref validation
      !/[\u0000-\u001f\u007f\s~^:?*[\]\\]/.test(value),
    "Invalid branch name"
  );

const providerRepoPathSchema = z
  .string()
  .trim()
  .min(3)
  .max(512)
  .refine((value) => {
    const parts = value.split("/");
    return (
      parts.length >= 1 &&
      parts.length <= MAX_PROVIDER_REPO_SEGMENTS &&
      parts.every(
        (part) =>
          part.length > 0 &&
          part !== "." &&
          part !== ".." &&
          /^[A-Za-z0-9_.-]+$/.test(part)
      )
    );
  }, "Use a provider repository path like owner/repo");

export const providerConnectSchema = z.object({
  token: z.string().trim().min(8).max(4_096),
});

export const providerRepositoriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(20).default(1),
});

export const projectImportSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2_000).optional().default(""),
  visibility: visibilitySchema.optional().default("private"),
  provider: gitProviderSchema,
  externalRepo: providerRepoPathSchema,
  branch: branchSchema.optional(),
  depth: z.coerce.number().int().min(1).max(MAX_IMPORT_DEPTH).optional(),
});

export const projectImportUrlSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2_000).optional().default(""),
  visibility: visibilitySchema.optional().default("private"),
  sourceUrl: z.string().trim().min(8).max(2_048),
  repositoryVisibility: z.enum(["public", "private"]),
  branch: branchSchema.optional(),
  depth: z.coerce.number().int().min(1).max(MAX_IMPORT_DEPTH).optional(),
});

export const projectImportRetrySchema = z.object({
  branch: branchSchema.optional(),
  depth: z.coerce.number().int().min(1).max(MAX_IMPORT_DEPTH).optional(),
});

export const memberAddSchema = z.object({
  identifier: z.string().trim().min(1).max(255),
  role: roleSchema,
});

export const memberUpdateSchema = z.object({
  role: roleSchema,
});

export const labelCreateSchema = z.object({
  title: z.string().trim().min(1).max(100),
  color: colorSchema,
  description: z.string().max(500).optional().default(""),
});

export const labelUpdateSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  color: colorSchema.optional(),
  description: z.string().max(500).optional(),
});

export const milestoneCreateSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(2_000).optional().default(""),
  dueDate: dateSchema,
});

export const milestoneUpdateSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(2_000).optional(),
  dueDate: dateSchema,
  state: z.enum(["active", "closed"]).optional(),
});

const idListSchema = z.array(idSchema).max(50).optional();
// Better Auth user IDs are opaque text, not UUIDs.
export const userIdSchema = z.string().trim().min(1).max(128);
const userIdListSchema = z.array(userIdSchema).max(50).optional();

export const issueCreateSchema = z.object({
  title: titleSchema,
  description: bodySchema,
  assigneeIds: userIdListSchema,
  labelIds: idListSchema,
  milestoneId: idSchema.nullable().optional(),
  dueDate: dateSchema,
  confidential: z.boolean().optional().default(false),
});

export const issueUpdateSchema = z.object({
  title: titleSchema.optional(),
  description: optionalBodySchema,
  assigneeIds: userIdListSchema,
  labelIds: idListSchema,
  milestoneId: idSchema.nullable().optional(),
  dueDate: dateSchema,
  confidential: z.boolean().optional(),
});

export const issueStateSchemaInput = z.object({
  state: issueStateSchema,
});

export const noteCreateSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Comment cannot be empty")
    .max(MAX_BODY_LENGTH),
});

export const cloneCredentialsSchema = z.object({
  scope: z.enum(["read", "write"]).default("read"),
});

export const mergeRequestCreateSchema = z.object({
  title: titleSchema,
  description: bodySchema,
  sourceBranch: z.string().trim().min(1).max(255),
  targetBranch: z.string().trim().min(1).max(255),
  assigneeIds: userIdListSchema,
  reviewerIds: userIdListSchema,
  milestoneId: idSchema.nullable().optional(),
  draft: z.boolean().optional().default(false),
});

export const mergeRequestUpdateSchema = z.object({
  title: titleSchema.optional(),
  description: optionalBodySchema,
  targetBranch: z.string().trim().min(1).max(255).optional(),
  assigneeIds: userIdListSchema,
  reviewerIds: userIdListSchema,
  milestoneId: idSchema.nullable().optional(),
  draft: z.boolean().optional(),
});

export const reviewerStateSchema = z.object({
  state: z.enum(["approved", "changes_requested"]),
});

export const boardMoveSchema = z.object({
  boardListId: idSchema,
});

export const boardListCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  labelId: idSchema,
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

export const searchSchema = z.object({
  // Queries longer than this are accepted and then truncated to 48 UTF-8
  // bytes so the LIKE pattern stays within D1's 50-byte limit.
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type GroupCreateInput = z.infer<typeof groupCreateSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type IssueCreateInput = z.infer<typeof issueCreateSchema>;
export type MergeRequestCreateInput = z.infer<typeof mergeRequestCreateSchema>;
