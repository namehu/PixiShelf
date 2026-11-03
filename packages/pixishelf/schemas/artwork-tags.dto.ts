import z from 'zod'

const tagId = z.number().int().positive().max(2_147_483_647)

export const ArtworkUpdateTagsSchema = z
  .object({
    artworkId: tagId,
    addTagIds: z
      .array(tagId)
      .default([])
      .transform((ids) => [...new Set(ids)]),
    removeTagIds: z
      .array(tagId)
      .default([])
      .transform((ids) => [...new Set(ids)]),
    newTagNames: z
      .array(z.string().trim().min(1, '标签名不能为空'))
      .default([])
      .transform((names) => [...new Set(names)])
  })
  .refine(({ addTagIds, removeTagIds }) => !addTagIds.some((id) => removeTagIds.includes(id)), {
    message: '同一标签不能同时添加和移除',
    path: ['removeTagIds']
  })

export type ArtworkUpdateTagsInput = z.infer<typeof ArtworkUpdateTagsSchema>
