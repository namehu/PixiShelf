'use client'

import { ColumnDef } from '@tanstack/react-table'
import { ArtistResponseDto } from '@/schemas/artist.dto'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export const columns: ColumnDef<ArtistResponseDto>[] = [
  {
    accessorKey: 'id',
    header: 'ID',
    cell: ({ row }) => <div className="w-[50px]">{row.getValue('id')}</div>
  },
  {
    accessorKey: 'avatar',
    header: '头像',
    cell: ({ row }) => {
      const avatar = row.getValue('avatar') as string
      const name = row.getValue('name') as string
      return (
        <Avatar>
          <AvatarImage src={avatar || ''} alt={name} />
          <AvatarFallback>{name?.substring(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      )
    }
  },
  {
    accessorKey: 'name',
    header: '姓名',
    enableSorting: true
  },
  {
    accessorKey: 'username',
    header: '用户名',
    cell: ({ row }) => {
      const username = row.getValue('username') as string
      return username ? <div className="text-muted-foreground">@{username}</div> : '-'
    }
  },
  {
    accessorKey: 'artworksCount',
    header: '作品数',
    cell: ({ row }) => {
      return <div className="font-medium">{row.getValue('artworksCount')}</div>
    },
    enableSorting: true
  },
  {
    accessorKey: 'createdAt',
    header: '创建时间',
    cell: ({ row }) => {
      return <div className="text-muted-foreground">{row.getValue('createdAt')}</div>
    }
  }
]
