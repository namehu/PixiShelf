/**
 * 标签翻译更新API
 * PUT /api/tags/[id]/translation
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { TagTranslationUpdateRequest, TagTranslationUpdateResponse } from '@/types/tags'
import { WZHBotTranslationService } from '@/lib/services/translationService'

interface RouteParams {
  params: {
    id: string
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const tagId = params.id

    // 验证标签ID
    if (!tagId) {
      return NextResponse.json({ success: false, error: 'Invalid tag ID' }, { status: 400 })
    }

    // 解析请求体
    const body: TagTranslationUpdateRequest = await request.json()
    const { name_zh, autoTranslate } = body

    // 验证请求参数
    if (!name_zh && !autoTranslate) {
      return NextResponse.json(
        {
          success: false,
          error: 'Either name_zh or autoTranslate must be provided'
        },
        { status: 400 }
      )
    }

    // 查找标签
    const existingTag = await prisma.tag.findUnique({
      where: { id: Number(tagId) },
      select: { id: true, name: true, name_zh: true }
    })

    if (!existingTag) {
      return NextResponse.json({ success: false, error: 'Tag not found' }, { status: 404 })
    }

    let translatedName = name_zh

    // 如果需要自动翻译
    if (autoTranslate && existingTag.name) {
      try {
        const translationService = new WZHBotTranslationService()
        const result = await translationService.translateText(existingTag.name)

        if (result.success && result.translatedText) {
          translatedName = result.translatedText
        } else {
          return NextResponse.json(
            {
              success: false,
              error: 'Translation failed',
              message: result.error || 'Unknown translation error'
            },
            { status: 500 }
          )
        }
      } catch (error) {
        console.error('Translation error:', error)
        return NextResponse.json(
          {
            success: false,
            error: 'Translation service error',
            message: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: 500 }
        )
      }
    }

    // 更新标签
    const updatedTag = await prisma.tag.update({
      where: { id: Number(tagId) },
      data: {
        name_zh: translatedName,
        updatedAt: new Date()
      },
      select: {
        id: true,
        name: true,
        name_zh: true,
        description: true,
        artworkCount: true,
        createdAt: true,
        updatedAt: true
      }
    })

    const response: TagTranslationUpdateResponse = {
      success: true,
      data: {
        tag: {
          ...updatedTag
        },
        translatedText: translatedName || null,
        wasAutoTranslated: !!autoTranslate
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Tag translation update error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
