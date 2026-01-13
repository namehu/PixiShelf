'use client'

import { ColumnDef } from '@tanstack/react-table'
import { ArtistResponseDto } from '@/schemas/artist.dto'
import { Button } from '@/components/ui/button'
import { ArrowUpDown } from 'lucide-react'
import Image from 'next/image'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export const columns: ColumnDef<ArtistResponseDto>[] = [
  {
    accessorKey: 'id',
    header: 'ID',
    cell: ({ row }) => <div className="w-[50px]">{row.getValue('id')}</div>,
    enableSorting: false
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
    },
    enableSorting: false
  },
  {
    accessorKey: 'name',
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="pl-0 hover:bg-transparent"
        >
          姓名
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      )
    }
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
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="pl-0 hover:bg-transparent"
        >
          作品数
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      )
    },
    cell: ({ row }) => {
      return <div className="font-medium">{row.getValue('artworksCount')}</div>
    }
  },
  {
    accessorKey: 'createdAt',
    header: '创建时间',
    cell: ({ row }) => {
      return <div className="text-muted-foreground">{row.getValue('createdAt')}</div>
    }
  }
]
