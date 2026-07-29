import { z } from "zod";

const optionalNullableString = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const tagsSchema = z
  .union([z.array(z.string()), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string") {
      return value
        .split(/[,，]/u)
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    return [];
  });

export const artworkRecordSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title_cn: z.string().min(1),
  title_en: optionalNullableString,
  artist: z.string().min(1),
  year_and_place: optionalNullableString,
  location: optionalNullableString,
  medium: optionalNullableString,
  dimensions: optionalNullableString,
  description: optionalNullableString,
  tags: tagsSchema,
  tags_text: optionalNullableString,
  source_name: optionalNullableString,
  source_url: optionalNullableString,
  thumbnail_url: optionalNullableString,
  display_url: optionalNullableString,
  download_url: optionalNullableString,
  iiif_url: optionalNullableString,
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export type ArtworkRecord = z.infer<typeof artworkRecordSchema>;

export function parseArtworkRecords(value: unknown): ArtworkRecord[] {
  const result = z.array(artworkRecordSchema).safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid artwork payload: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
