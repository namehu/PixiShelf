'use client'

import { useId } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import {
  ARCHIVE_TITLE_RULE_OPERATORS,
  archiveTitleConditionSchema,
  type ArchiveTitleRules,
  type ArchiveTitleCondition
} from '@pixishelf/job-contracts'
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArchiveRuleHelp } from './archive-rule-help'

const groups = [
  { key: 'any', label: '满足任一条件', description: '至少命中其中一条，支持多个标记或别名。' },
  { key: 'all', label: '同时满足这些条件', description: '可选；同一个标题还需要满足这里的全部条件。' },
  { key: 'none', label: '排除条件', description: '可选；任一语言标题命中其中一条即过滤。' }
] as const
const help: Record<ArchiveTitleCondition['operator'], string> = {
  CONTAINS: '标题中包含输入文本即可；方括号等标点按原样匹配。',
  WHOLE_WORD: '空格、方括号等标点可分隔完整词。例如 RAG 匹配 [RAG]，不匹配 Ragnarok、RAG_01。',
  STARTS_WITH: '标题去除首尾空白后，必须以输入文本开头。',
  ENDS_WITH: '标题去除首尾空白后，必须以输入文本结尾。',
  EQUALS: '标题去除首尾空白后，必须与输入文本完全相等；内部空白和标点仍参与判断。',
  REGEX: '直接填写表达式，不加 /…/。支持分组、分支、字符类和重复；不支持环视、反向引用及内联标志。'
}

export function ArchiveTitleRuleFields({
  value,
  onChange,
  disabled = false
}: {
  value: ArchiveTitleRules
  onChange: (rules: ArchiveTitleRules) => void
  disabled?: boolean
}) {
  const prefix = useId()
  const update = (group: 'any' | 'all' | 'none', index: number, patch: Partial<ArchiveTitleCondition>) =>
    onChange({
      ...value,
      version: 2,
      [group]: value[group].map((row, i) => (i === index ? { ...row, ...patch } : row))
    })
  return (
    <FieldGroup className="gap-6">
      {groups.map(({ key, label, description }) => (
        <FieldSet key={key} className="min-w-0 gap-2" aria-label={label}>
          <FieldLegend className="mb-0 w-full">
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
                {label}
                <ArchiveRuleHelp label={`${label}说明`}>{description}</ArchiveRuleHelp>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 whitespace-nowrap"
                disabled={disabled || value[key].length >= 20}
                aria-label={`添加${key === 'none' ? '排除' : ''}条件`}
                onClick={() =>
                  onChange({
                    ...value,
                    version: 2,
                    [key]: [...value[key], { operator: 'CONTAINS', text: '', ignoreCase: false }]
                  })
                }
              >
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
                添加
              </Button>
            </span>
          </FieldLegend>
          {value[key].map((condition, index) => {
            const validation = archiveTitleConditionSchema.safeParse(condition)
            const error = condition.text && !validation.success ? validation.error.issues[0]?.message : null
            const rowId = `${prefix}-${key}-${index}`
            return (
              <FieldGroup key={index} className="gap-1">
                <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)_2.75rem_2rem_2rem] items-center gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto_2rem_2rem] sm:gap-2">
                  <Field className="min-w-0">
                    <FieldLabel className="sr-only" htmlFor={`${rowId}-operator`}>
                      {label} {index + 1} 匹配方式
                    </FieldLabel>
                    <Select
                      value={condition.operator}
                      disabled={disabled}
                      onValueChange={(operator) => {
                        if (Object.hasOwn(ARCHIVE_TITLE_RULE_OPERATORS, operator)) {
                          update(key, index, { operator: operator as ArchiveTitleCondition['operator'] })
                        }
                      }}
                    >
                      <SelectTrigger
                        id={`${rowId}-operator`}
                        className="w-full gap-1 px-2 text-xs data-[size=default]:h-10 sm:text-sm"
                      >
                        <SelectValue>
                          <span className="sm:hidden">
                            {condition.operator === 'EQUALS'
                              ? '标题相等'
                              : condition.operator === 'REGEX'
                                ? '正则'
                                : ARCHIVE_TITLE_RULE_OPERATORS[condition.operator]}
                          </span>
                          <span className="hidden sm:inline">{ARCHIVE_TITLE_RULE_OPERATORS[condition.operator]}</span>
                        </SelectValue>
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
                  <Field className="min-w-0" data-invalid={Boolean(error)}>
                    <FieldLabel className="sr-only" htmlFor={`${rowId}-text`}>
                      {label} {index + 1} 文本
                    </FieldLabel>
                    <Input
                      id={`${rowId}-text`}
                      className="h-10 min-w-0 px-2"
                      value={condition.text}
                      maxLength={160}
                      placeholder={condition.operator === 'REGEX' ? '^\\[RAG\\]' : key === 'any' ? '[RAG]' : '匹配文本'}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${rowId}-error` : undefined}
                      disabled={disabled}
                      onChange={(event) => update(key, index, { text: event.target.value })}
                    />
                  </Field>
                  <Field orientation="horizontal" className="w-auto gap-1.5" data-disabled={disabled}>
                    <Checkbox
                      id={`${rowId}-case`}
                      checked={condition.ignoreCase === false}
                      disabled={disabled}
                      aria-label={`${label} ${index + 1} 区分大小写`}
                      onCheckedChange={(checked) => update(key, index, { ignoreCase: checked !== true })}
                    />
                    <FieldLabel htmlFor={`${rowId}-case`} className="min-h-10 cursor-pointer whitespace-nowrap">
                      <span aria-hidden="true" className="sm:hidden">
                        Aa
                      </span>
                      <span className="hidden sm:inline">区分大小写</span>
                    </FieldLabel>
                  </Field>
                  <ArchiveRuleHelp label={`${label}第 ${index + 1} 条说明`}>
                    <div className="flex flex-col gap-2">
                      <p>{help[condition.operator]}</p>
                      <p>
                        勾选“区分大小写”时，RAG 与 rag
                        不同；取消勾选则视为相同。新增条件默认勾选，已有条件保留保存时的设置。
                      </p>
                    </div>
                  </ArchiveRuleHelp>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={disabled || (key === 'any' && value.any.length === 1)}
                    aria-label={`移除${label}第 ${index + 1} 条`}
                    onClick={() => onChange({ ...value, version: 2, [key]: value[key].filter((_, i) => i !== index) })}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
                {error ? <FieldError id={`${rowId}-error`}>{error}</FieldError> : null}
              </FieldGroup>
            )
          })}
        </FieldSet>
      ))}
    </FieldGroup>
  )
}
