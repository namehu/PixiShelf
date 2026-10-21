'use client'

import { PlusIcon, XIcon } from 'lucide-react'
import {
  ARCHIVE_TITLE_RULE_OPERATORS,
  type ArchiveTitleRules,
  type ArchiveTitleCondition
} from '@pixishelf/job-contracts'
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const groups = [
  { key: 'any', label: '满足任一条件', description: '至少命中其中一条，支持多个标记或别名。' },
  { key: 'all', label: '同时满足这些条件', description: '可选；同一个标题还需要满足这里的全部条件。' },
  { key: 'none', label: '排除条件', description: '可选；任一语言标题命中其中一条即过滤。' }
] as const

export function ArchiveTitleRuleFields({
  value,
  onChange,
  disabled = false
}: {
  value: ArchiveTitleRules
  onChange: (rules: ArchiveTitleRules) => void
  disabled?: boolean
}) {
  const update = (group: 'any' | 'all' | 'none', index: number, patch: Partial<ArchiveTitleCondition>) =>
    onChange({ ...value, [group]: value[group].map((row, i) => (i === index ? { ...row, ...patch } : row)) })
  return (
    <FieldGroup className="gap-6">
      {groups.map(({ key, label, description }) => (
        <FieldSet key={key} className="min-w-0 gap-3" disabled={disabled}>
          <FieldLegend className="mb-0">{label}</FieldLegend>
          <FieldDescription>{description}</FieldDescription>
          {value[key].map((condition, index) => (
            <div
              key={index}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.75rem] items-end gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_2.75rem]"
            >
              <Field className="min-w-0 max-sm:col-span-2">
                <FieldLabel className="sr-only" htmlFor={`title-rule-${key}-${index}-operator`}>
                  {label} {index + 1} 匹配方式
                </FieldLabel>
                <Select
                  value={condition.operator}
                  onValueChange={(operator) => {
                    if (Object.hasOwn(ARCHIVE_TITLE_RULE_OPERATORS, operator)) {
                      update(key, index, { operator: operator as ArchiveTitleCondition['operator'] })
                    }
                  }}
                  disabled={disabled}
                >
                  <SelectTrigger id={`title-rule-${key}-${index}-operator`} className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(ARCHIVE_TITLE_RULE_OPERATORS).map(([operator, title]) => (
                        <SelectItem key={operator} value={operator}>
                          {title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field className="min-w-0">
                <FieldLabel className="sr-only" htmlFor={`title-rule-${key}-${index}-text`}>
                  {label} {index + 1} 文本
                </FieldLabel>
                <Input
                  id={`title-rule-${key}-${index}-text`}
                  className="h-11"
                  value={condition.text}
                  maxLength={160}
                  placeholder={key === 'any' ? '例如 [RAG]' : '输入要匹配的文本'}
                  disabled={disabled}
                  onChange={(event) => update(key, index, { text: event.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11"
                disabled={disabled || (key === 'any' && value.any.length === 1)}
                aria-label={`移除${label}第 ${index + 1} 条`}
                onClick={() => onChange({ ...value, [key]: value[key].filter((_, i) => i !== index) })}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="h-11 w-fit"
            disabled={disabled || value[key].length >= 20}
            onClick={() => onChange({ ...value, [key]: [...value[key], { operator: 'CONTAINS', text: '' }] })}
          >
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            添加{key === 'none' ? '排除' : ''}条件
          </Button>
        </FieldSet>
      ))}
    </FieldGroup>
  )
}
