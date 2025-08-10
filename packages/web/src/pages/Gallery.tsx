import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson, apiRequest } from "../api";

function useArtworks(page: number, pageSize: number) {
  return useQuery({
    queryKey: ["artworks", page, pageSize],
    queryFn: async () => {
      const url = new URL("/api/v1/artworks", window.location.origin);
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      return apiJson<{
        items: any[];
        total: number;
        page: number;
        pageSize: number;
      }>(url.toString());
    },
  });
}

function useScanStatus() {
  return useQuery({
    queryKey: ["scanStatus"],
    queryFn: async () => {
      return apiJson<{ scanning: boolean; message: string | null }>(
        "/api/v1/scan/status"
      );
    },
    refetchInterval: (q) => {
      const data = q.state.data as any;
      return data?.scanning ? 1000 : false;
    },
  });
}

export default function Gallery() {
  const [sp, setSp] = useSearchParams();
  const queryClient = useQueryClient();
  const page = parseInt(sp.get("page") || "1", 10);
  const pageSize = 24;
  const { data, isLoading, isError } = useArtworks(page, pageSize);

  const scanner = useMutation({
    mutationFn: async () => {
      return apiJson("/api/v1/scan", {
        method: "POST",
        body: JSON.stringify({ force: false }),
      });
    },
    onSuccess: () => {
      // 强制刷新扫描状态与作品列表
      queryClient.invalidateQueries({ queryKey: ["scanStatus"] });
      queryClient.invalidateQueries({ queryKey: ["artworks"] });
    },
  });

  const scanStatus = useScanStatus();

  const goto = (p: number) => setSp({ page: String(p) });

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">画廊</h2>
        <div className="flex items-center gap-2">
          <button
            className="rounded bg-brand-600 px-3 py-2 text-white hover:bg-brand-700"
            onClick={() => scanner.mutate()}
            disabled={scanner.isPending}
          >
            {scanner.isPending ? "扫描中…" : "触发扫描"}
          </button>
          {scanStatus.data?.scanning && (
            <span className="text-sm text-gray-600">
              扫描中：{scanStatus.data.message || "…"}
            </span>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: pageSize }).map((_, i) => (
            <div
              key={i}
              className="aspect-[4/3] rounded-lg bg-gray-200 animate-pulse"
            />
          ))}
        </div>
      )}
      {isError && <div className="text-red-600">加载失败，请确认已登录。</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {data.items.map((aw) => {
              const id = aw.id;
              const cover = aw.images?.[0];
              const src = cover
                ? `/api/v1/images/${encodeURIComponent(cover.path)}`
                : "";
              const artistName = aw.artist?.name as string | undefined;

              return (
                <Link key={id} to={`/artworks/${id}`} className="group block">
                  <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-gray-100">
                    {src ? (
                      <img
                        src={src}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-full w-full bg-gray-200" />
                    )}
                  </div>
                  <div className="mt-2 text-sm text-gray-800">{aw.title}</div>
                  {artistName && (
                    <div
                      className="truncate text-xs text-gray-500"
                      title={artistName}
                    >
                      {artistName}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>

          {data.total > pageSize && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => goto(page - 1)}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
              >
                上一页
              </button>
              <span className="text-sm text-gray-600">
                第 {page} 页 / 共 {Math.ceil(data.total / pageSize)} 页
              </span>
              <button
                disabled={page >= Math.ceil(data.total / pageSize)}
                onClick={() => goto(page + 1)}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
