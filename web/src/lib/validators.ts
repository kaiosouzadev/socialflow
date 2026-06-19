import { z } from "zod";

/**
 * Permissive UUID validator: accepts any well-formed 8-4-4-4-12 hex string.
 *
 * Zod 4's `z.string().uuid()` enforces RFC 4122 version/variant bits, which
 * rejects perfectly valid Postgres UUIDs that don't follow v1-v8 layout
 * (e.g. fixture ids like 11111111-1111-1111-1111-111111111111). Since the
 * value is only used to look a row up by primary key, well-formed is enough.
 */
export const uuidString = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "ID inválido"
  );
