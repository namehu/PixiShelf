'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseAsString, useQueryStates } from 'nuqs'
import { ArrowUpDownIcon, SearchIcon, XIcon } from 'lucide-react'
import type { ArtistsQuery } from '@/types'
import PageToolbar from '@/components/layout/page-toolbar'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const searchParamsParsers = {
  search: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  sortBy: parseAsString.withDefault('name_asc').withOptions({ history: 'replace', clearOnDefault: true })
}

const ArtistsNavigation = () => {
  const [queryStates, setQueryStates] = useQueryStates(searchParamsParsers)
  const { search: currentSearch, sortBy: currentSortBy } = queryStates
  const [searchValue, setSearchValue] = useState(currentSearch)

  useEffect(() => setSearchValue(currentSearch), [currentSearch])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchValue !== currentSearch) setQueryStates({ search: searchValue || null })
    }, 300)

    return () => clearTimeout(timer)
  }, [currentSearch, searchValue, setQueryStates])

  const handleClearSearch = useCallback(() => {
    setSearchValue('')
    setQueryStates({ search: null })
  }, [setQueryStates])

  const sortOptions: { value: ArtistsQuery['sortBy']; label: string }[] = useMemo(
    () => [
      { value: 'name_asc', label: '名称 A–Z' },
      { value: 'name_desc', label: '名称 Z–A' },
      { value: 'artworks_desc', label: '作品数：多到少' },
      { value: 'artworks_asc', label: '作品数：少到多' }
    ],
    []
  )

  return (
    <PageToolbar containerSize="gallery">
      <div className="flex w-full items-center gap-2 sm:gap-3">
        <InputGroup className="max-w-2xl flex-1">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            name="artist-search"
            autoComplete="off"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="搜索艺术家…"
            aria-label="搜索艺术家"
          />
          {searchValue && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" onClick={handleClearSearch} aria-label="清除艺术家搜索">
                <XIcon data-icon="inline-start" aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>

        <Select value={currentSortBy} onValueChange={(value) => setQueryStates({ sortBy: value })}>
          <SelectTrigger
            className="w-11 [&>svg:last-child]:hidden sm:w-44 sm:[&>svg:last-child]:block"
            aria-label="艺术家排序"
          >
            <ArrowUpDownIcon className="text-muted-foreground" aria-hidden="true" />
            <SelectValue className="hidden truncate sm:block" />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value || ''}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </PageToolbar>
  )
}

export default ArtistsNavigation
