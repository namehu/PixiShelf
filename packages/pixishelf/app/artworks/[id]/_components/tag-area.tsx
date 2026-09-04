import Link from 'next/link'
import { memo, type FC } from 'react'
import type { TArtworkTagDto } from '@/schemas/artwork.dto'
import { getTranslateName } from '@/utils/tags'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

interface TagAreaProps {
  tags?: TArtworkTagDto[]
}

const TagArea: FC<TagAreaProps> = ({ tags = [] }) => (
  <section aria-labelledby="artwork-tags-heading">
    <h2 id="artwork-tags-heading" className="sr-only">
      标签
    </h2>
    <div className="flex max-w-full flex-wrap gap-2">
      {tags.map((tag) => {
        const translatedName = getTranslateName(tag)

        return (
          <Link
            href={`/tags/${tag.id}`}
            key={tag.id}
            className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-sm text-accent-foreground outline-none hover:bg-accent/75 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <PrivacySensitiveText className="break-all font-medium">#{tag.name}</PrivacySensitiveText>
            {translatedName && (
              <PrivacySensitiveText className="truncate text-xs text-muted-foreground">
                {translatedName}
              </PrivacySensitiveText>
            )}
          </Link>
        )
      })}
    </div>
  </section>
)

export default memo(TagArea)
