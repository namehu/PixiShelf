import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Artist, ArtistsQuery, Artwork } from '@pixishelf/shared'
import ArtistCard from '@/components/ArtistCard'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Search, Users, Loader2 } from 'lucide-react'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { useDebounce } from '@/hooks/useDebounce'
import { apiJson } from '@/api'

interface ArtistsPageProps {
  onArtistClick?: (artist: Artist) => void
}

const SORT_OPTIONS = [
  { value: 'name_asc', label: '名称 A-Z' },
  { value: 'name_desc', label: '名称 Z-A' },
  { value: 'artworks_desc', label: '作品数量（多到少）' },
  { value: 'artworks_asc', label: '作品数量（少到多）' }
] as const

export function ArtistsPage({ onArtistClick }: ArtistsPageProps) {
  const navigate = useNavigate()
  const [artists, setArtists] = useState<Artist[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<ArtistsQuery['sortBy']>('name_asc')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const debouncedSearch = useDebounce(search, 300)

  const fetchArtists = useCallback(
    async (pageNum: number, isNewSearch = false) => {
      try {
        setLoading(true)
        setError(null)

        const params = new URLSearchParams({
          page: pageNum.toString(),
          pageSize: '40'
        })

        if (debouncedSearch) {
          params.append('search', debouncedSearch)
        }
        if (sortBy) {
          params.append('sortBy', sortBy)
        }

        const data = await apiJson<any>(`/api/v1/artists?${params}`)

        if (isNewSearch || pageNum === 1) {
          setArtists(data.items)
        } else {
          setArtists((prev) => [...prev, ...data.items])
        }

        setTotal(data.total)
        setHasMore(data.items.length === 40)
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误')
      } finally {
        setLoading(false)
      }
    },
    [debouncedSearch, sortBy]
  )

  // 重置搜索
  const resetSearch = useCallback(() => {
    setPage(1)
    setArtists([])
    setHasMore(true)
    setError(null)
  }, [])

  // 搜索或排序变化时重新加载
  useEffect(() => {
    resetSearch()
    fetchArtists(1, true)
  }, [debouncedSearch, sortBy, resetSearch, fetchArtists])

  // 无限滚动
  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      const nextPage = page + 1
      setPage(nextPage)
      fetchArtists(nextPage)
    }
  }, [loading, hasMore, page, fetchArtists])

  const { targetRef } = useInfiniteScroll({
    onLoadMore: loadMore,
    hasMore,
    loading
  })

  const handleArtistClick = (artist: Artist) => {
    if (onArtistClick) {
      onArtistClick(artist)
    } else {
      navigate(`/artists/${artist.id}`)
    }
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* 页面标题 */}
      <div className="flex items-center space-x-3 mb-8">
        <Users className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">艺术家</h1>
          <p className="text-gray-600 dark:text-gray-400">发现和探索才华横溢的艺术家</p>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="搜索艺术家名称或用户名..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={sortBy} onValueChange={(value: ArtistsQuery['sortBy']) => setSortBy(value)}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="排序方式" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 结果统计 */}
      {!loading && (
        <div className="mb-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {debouncedSearch ? (
              <>
                找到 {total} 个匹配 "{debouncedSearch}" 的艺术家
              </>
            ) : (
              <>共 {total} 个艺术家</>
            )}
          </p>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => fetchArtists(1, true)}>
            重试
          </Button>
        </div>
      )}

      {/* 艺术家网格 */}
      {artists.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {artists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} onClick={() => handleArtistClick(artist)} />
          ))}
        </div>
      ) : (
        !loading && (
          <div className="text-center py-12">
            <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {debouncedSearch ? '未找到匹配的艺术家' : '暂无艺术家'}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {debouncedSearch ? '尝试调整搜索关键词' : '等待艺术家加入平台'}
            </p>
          </div>
        )
      )}

      {/* 加载更多指示器 */}
      {loading && (
        <div className="flex justify-center items-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          <span className="ml-2 text-gray-600 dark:text-gray-400">加载中...</span>
        </div>
      )}

      {/* 无限滚动触发器 */}
      <div ref={targetRef} className="h-4" />
    </div>
  )
}

export default ArtistsPage
