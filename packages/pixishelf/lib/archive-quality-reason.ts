export const archiveQualityReasonLabels: Record<string, string> = {
  CURRENT_IMAGE_IDENTITY_MISMATCH: '当前图片身份、路径或顺序与归档快照不一致',
  CURRENT_MEDIA_SET_MISMATCH: '当前图片总数与归档快照不一致，整个归档需要重新核验',
  INVALID_MEDIA_SNAPSHOT: '归档媒体快照缺失或损坏，无法逐页对应',
  INVALID_QUALITY_EVIDENCE: '已保存的画质证据缺失或损坏，请重新核验',
  NOT_AUDITED: '这部作品尚未核验',
  DUPLICATE_MEDIA_IDENTITY: '归档快照中的页码或图片身份重复',
  SUCCESSFUL_ITEM_MISMATCH: '成功下载记录与修订的文件摘要或大小不一致',
  NO_FINAL_SUCCESSFUL_ATTEMPT: '缺少可对应的最终成功下载尝试',
  DELIVERY_RECEIPT_MISMATCH: '交付凭据与成功下载记录不一致',
  DELIVERY_CLASSIFICATION_MISMATCH: '交付凭据与画质证据冲突',
  DELIVERED_FILE_CONFLICTS_WITH_DESCRIPTOR: '实收文件与交付地址声明不一致',
  RESPONSE_MIME_CONFLICTS_WITH_FILE: '响应声明的文件格式与实收文件不一致',
  ORIGINAL_DECLARATION_CONFLICTS_WITH_FILE: '原站原图声明与实收文件不一致',
  INCOMPLETE_MEDIA_FACTS: '缺少核验所需的文件信息',
  NO_TRUSTED_HATH_EVIDENCE: '交付地址缺少可信画质证据',
  HATH_H_WITHOUT_EXPLICIT_XRES: '旧交付地址没有明确标注原图或缩放档位',
  HATH_H_UNSUPPORTED_XRES: '交付档位超出可核验范围',
  HATH_H_XRES_WIDTH_MISMATCH: '交付宽度与标注档位不同，缺少原图对照',
  INVALID_DELIVERY_URL: '归档交付地址无效',
  INVALID_HATH_DELIVERED_DESCRIPTOR: '交付地址中的文件描述无效',
  CONFLICTING_HATH_DESCRIPTORS: '交付地址的原件与派生件描述冲突',
  CONFLICTING_HATH_XRES: '交付地址中的缩放档位互相冲突',
  DUPLICATE_HATH_XRES: '交付地址重复标注同一档位',
  UNSUPPORTED_HATH_PATH: '旧交付地址不包含支持的画质证据',
  NO_VERIFIED_DELIVERY_EVIDENCE: '已保存的归档记录不足以证明文件版本'
}

export function archiveQualityReasonLabel(reason: string) {
  return archiveQualityReasonLabels[reason] ?? archiveQualityReasonLabels.NO_VERIFIED_DELIVERY_EVIDENCE
}

export function archiveImageVersionReason(reason: string) {
  switch (reason) {
    case 'NOT_AUDITED':
      return '现有下载记录还没有用来确认这部作品的图片版本。'
    case 'CURRENT_IMAGE_IDENTITY_MISMATCH':
    case 'CURRENT_MEDIA_SET_MISMATCH':
    case 'INVALID_MEDIA_SNAPSHOT':
    case 'DUPLICATE_MEDIA_IDENTITY':
    case 'SUCCESSFUL_ITEM_MISMATCH':
    case 'NO_FINAL_SUCCESSFUL_ATTEMPT':
      return '找不到能与已保存图片对应的下载记录。'
    case 'DELIVERY_RECEIPT_MISMATCH':
    case 'DELIVERY_CLASSIFICATION_MISMATCH':
    case 'DELIVERED_FILE_CONFLICTS_WITH_DESCRIPTOR':
    case 'RESPONSE_MIME_CONFLICTS_WITH_FILE':
    case 'ORIGINAL_DECLARATION_CONFLICTS_WITH_FILE':
    case 'CONFLICTING_HATH_DESCRIPTORS':
    case 'CONFLICTING_HATH_XRES':
      return '下载记录对同一张图片的描述不一致。'
    default:
      return '下载记录没有足够信息，无法确认是否与原图一致。'
  }
}
