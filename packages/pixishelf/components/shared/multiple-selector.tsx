'use client'

import { Command as CommandPrimitive, useCommandState } from 'cmdk'
import { X, ChevronDownIcon } from 'lucide-react'
import * as React from 'react'
import { forwardRef, useEffect } from 'react'

import { Badge } from '@/components/ui/badge'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'

export interface Option {
  value: string
  label: string
  disable?: boolean
  /** 固定项（不可移除）。 */
  fixed?: boolean
  /** 可按 key 建立分组。 */
  [key: string]: string | boolean | undefined | null
}
interface GroupOption {
  [key: string]: Option[]
}

interface MultipleSelectorProps {
  value?: Option[]
  defaultOptions?: Option[]
  /** 手动受控的 `options`，配合外部状态更新。 */
  options?: Option[]
  placeholder?: string
  /** 加载中的组件。 */
  loadingIndicator?: React.ReactNode
  /** 空列表展示组件。 */
  emptyIndicator?: React.ReactNode
  /** 异步搜索防抖时长，仅对 `onSearch` 生效。 */
  delay?: number
  /**
   * 仅在 `onSearch` 存在时生效。`onFocus` 时可立即触发检索。
   * 常用于点击输入框后立刻加载默认候选。
   **/
  triggerSearchOnFocus?: boolean
  /** 异步搜索（返回 Promise）。 */
  onSearch?: (value: string) => Promise<Option[]>
  /**
   * 同步搜索（返回数组）。
   * 该模式不展示 loadingIndicator，其余行为参数与异步搜索保持一致（如：creatable、groupBy、delay）。
   **/
  onSearchSync?: (value: string) => Option[]
  onChange?: (options: Option[]) => void
  /** 限制最大可选项数量。 */
  maxSelected?: number
  /** 超过上限时会回调 `onMaxSelected`。 */
  onMaxSelected?: (maxLimit: number) => void
  /** 有选中项时隐藏占位符。 */
  hidePlaceholderWhenSelected?: boolean
  disabled?: boolean
  /** 按给定字段分组。 */
  groupBy?: string
  className?: string
  badgeClassName?: string
  /**
   * cmdk 默认会自动选中首项，因此默认保留 true。
   * 通过添加占位项实现兼容方案，避免边界行为差异。
   *
   * @reference: https://github.com/pacocoursey/cmdk/issues/171
   */
  selectFirstItem?: boolean
  /** 无匹配项时支持用户手动创建新选项。 */
  creatable?: boolean
  /** `Command` 的 Props。 */
  commandProps?: React.ComponentPropsWithoutRef<typeof Command>
  /** `CommandInput` 的 Props。 */
  inputProps?: Omit<React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>, 'value' | 'placeholder' | 'disabled'>
  /** 隐藏“清空全部”按钮。 */
  hideClearAllButton?: boolean
}

export interface MultipleSelectorRef {
  selectedValue: Option[]
  input: HTMLInputElement
  focus: () => void
  reset: () => void
}

export function useDebounce<T>(value: T, delay?: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay || 500)

    return () => {
      clearTimeout(timer)
    }
  }, [value, delay])

  return debouncedValue
}

function transToGroupOption(options: Option[], groupBy?: string) {
  if (options.length === 0) {
    return {}
  }
  if (!groupBy) {
    return {
      '': options
    }
  }

  const groupOption: GroupOption = {}
  options.forEach((option) => {
    const key = (option[groupBy] as string) || ''
    if (!groupOption[key]) {
      groupOption[key] = []
    }
    groupOption[key].push(option)
  })
  return groupOption
}

function removePickedOption(groupOption: GroupOption, picked: Option[]) {
  const cloneOption = JSON.parse(JSON.stringify(groupOption)) as GroupOption

  for (const [key, value] of Object.entries(cloneOption)) {
    cloneOption[key] = value.filter((val) => !picked.find((p) => p.value === val.value))
  }
  return cloneOption
}

function isOptionsExist(groupOption: GroupOption, targetOption: Option[]) {
  for (const [, value] of Object.entries(groupOption)) {
    if (value.some((option) => targetOption.find((p) => p.value === option.value))) {
      return true
    }
  }
  return false
}

/**
 * shadcn/ui 的 `CommandEmpty` 在该场景下会导致 cmdk 空态无法正确渲染，
 * 所以这里自定义 Empty 组件并复用 `cmdk` 的实现方式。
 *
 * @reference: https://github.com/hsuanyi-chou/shadcn-ui-expansions/issues/34#issuecomment-1949561607
 */
const CommandEmpty = forwardRef<HTMLDivElement, React.ComponentProps<typeof CommandPrimitive.Empty>>(
  ({ className, ...props }, forwardedRef) => {
    const render = useCommandState((state) => state.filtered.count === 0)

    if (!render) return null

    return (
      <div
        ref={forwardedRef}
        className={cn('py-6 text-center text-sm', className)}
        // oxlint-disable-next-line no-unknown-property
        cmdk-empty=""
        role="presentation"
        {...props}
      />
    )
  }
)

CommandEmpty.displayName = 'CommandEmpty'

const MultipleSelector = React.forwardRef<MultipleSelectorRef, MultipleSelectorProps>(
  (
    {
      value,
      onChange,
      placeholder,
      defaultOptions: arrayDefaultOptions = [],
      options: arrayOptions,
      delay,
      onSearch,
      onSearchSync,
      loadingIndicator,
      emptyIndicator,
      maxSelected = Number.MAX_SAFE_INTEGER,
      onMaxSelected,
      hidePlaceholderWhenSelected,
      disabled,
      groupBy,
      className,
      badgeClassName,
      selectFirstItem = true,
      creatable = false,
      triggerSearchOnFocus = false,
      commandProps,
      inputProps,
      hideClearAllButton = false
    }: MultipleSelectorProps,
    ref: React.Ref<MultipleSelectorRef>
  ) => {
    const inputRef = React.useRef<HTMLInputElement>(null)
    const [open, setOpen] = React.useState(false)
    const [onScrollbar, setOnScrollbar] = React.useState(false)
    const [isLoading, setIsLoading] = React.useState(false)
    const dropdownRef = React.useRef<HTMLDivElement>(null) // 用于监听下拉区域外点击并关闭面板

    const [selected, setSelected] = React.useState<Option[]>(value || [])
    const [options, setOptions] = React.useState<GroupOption>(transToGroupOption(arrayDefaultOptions, groupBy))
    const [inputValue, setInputValue] = React.useState('')
    const debouncedSearchTerm = useDebounce(inputValue, delay || 500)

    React.useImperativeHandle(
      ref,
      () => ({
        selectedValue: [...selected],
        input: inputRef.current as HTMLInputElement,
        focus: () => inputRef?.current?.focus(),
        reset: () => setSelected([])
      }),
      [selected]
    )

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
        inputRef.current.blur()
      }
    }

    const handleUnselect = React.useCallback(
      (option: Option) => {
        const newOptions = selected.filter((s) => s.value !== option.value)
        setSelected(newOptions)
        onChange?.(newOptions)
      },
      [onChange, selected]
    )

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        const input = inputRef.current
        if (input) {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            if (input.value === '' && selected.length > 0) {
              const lastSelectOption = selected[selected.length - 1]
              // 输入为空且最后一项非固定时，允许用退格键快速删除末尾项。
              if (lastSelectOption && !lastSelectOption.fixed) {
                handleUnselect(lastSelectOption)
              }
            }
          }
          // Escape 默认不会清空输入，这里只移除焦点以关闭面板。
          if (e.key === 'Escape') {
            input.blur()
          }
        }
      },
      [handleUnselect, selected]
    )

    useEffect(() => {
      if (open) {
        document.addEventListener('mousedown', handleClickOutside)
        document.addEventListener('touchend', handleClickOutside)
      } else {
        document.removeEventListener('mousedown', handleClickOutside)
        document.removeEventListener('touchend', handleClickOutside)
      }

      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        document.removeEventListener('touchend', handleClickOutside)
      }
    }, [open])

    useEffect(() => {
      if (value) {
        setSelected(value)
      }
    }, [value])

    useEffect(() => {
      /** 当 `onSearch` 存在时，不允许 `arrayOptions` 覆盖结果，避免混用本地/远端数据源。 */
      if (!arrayOptions || onSearch) {
        return
      }
      const newOption = transToGroupOption(arrayOptions || [], groupBy)
      if (JSON.stringify(newOption) !== JSON.stringify(options)) {
        setOptions(newOption)
      }
    }, [arrayDefaultOptions, arrayOptions, groupBy, onSearch, options])

    useEffect(() => {
      /** 同步搜索：依赖开关仅在面板打开时执行。 */

      const doSearchSync = () => {
        const res = onSearchSync?.(debouncedSearchTerm)
        setOptions(transToGroupOption(res || [], groupBy))
      }

      const exec = async () => {
        if (!onSearchSync || !open) return

        if (triggerSearchOnFocus || debouncedSearchTerm) {
          doSearchSync()
        }
      }

      void exec()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearchTerm, groupBy, open, triggerSearchOnFocus])

    useEffect(() => {
      /** 异步搜索：依赖 `debouncedSearchTerm`，避免每次输入触发请求。 */

      const doSearch = async () => {
        setIsLoading(true)
        const res = await onSearch?.(debouncedSearchTerm)
        setOptions(transToGroupOption(res || [], groupBy))
        setIsLoading(false)
      }

      const exec = async () => {
        if (!onSearch || !open) return

        if (triggerSearchOnFocus || debouncedSearchTerm) {
          await doSearch()
        }
      }

      void exec()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearchTerm, groupBy, open, triggerSearchOnFocus])

    const creatableItem = () => {
      if (!creatable) return undefined
      if (
        isOptionsExist(options, [{ value: inputValue, label: inputValue }]) ||
        selected.find((s) => s.value === inputValue)
      ) {
        return undefined
      }

      const Item = (
        <CommandItem
          value={inputValue}
          className="cursor-pointer"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onSelect={(value: string) => {
            if (selected.length >= maxSelected) {
              onMaxSelected?.(selected.length)
              return
            }
            setInputValue('')
            const newOptions = [...selected, { value, label: value }]
            setSelected(newOptions)
            onChange?.(newOptions)
            if (newOptions.length >= maxSelected) {
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
        >
          {`Create "${inputValue}"`}
        </CommandItem>
      )

      // 非异步搜索时，仅在输入不为空时显示“创建”项
      if (!onSearch && inputValue.length > 0) {
        return Item
      }

      // 异步搜索下，等待搜索结果返回后再展示“创建”项，避免闪现误导
      if (onSearch && debouncedSearchTerm.length > 0 && !isLoading) {
        return Item
      }

      return undefined
    }

    const emptyItem = React.useCallback(() => {
      if (!emptyIndicator) return undefined

      // 异步搜索且无结果且不可创建时显示空状态
      if (onSearch && !creatable && Object.keys(options).length === 0) {
        return (
          <CommandItem value="-" disabled>
            {emptyIndicator}
          </CommandItem>
        )
      }

      return <CommandEmpty>{emptyIndicator}</CommandEmpty>
    }, [creatable, emptyIndicator, onSearch, options])

    const selectables = React.useMemo<GroupOption>(() => removePickedOption(options, selected), [options, selected])

    /** 长文本粘贴场景复用筛选函数，避免 `creatable` 模式下卡顿。 */
    const commandFilter = React.useCallback(() => {
      if (commandProps?.filter) {
        return commandProps.filter
      }

      if (creatable) {
        return (value: string, search: string) => {
          return value.toLowerCase().includes(search.toLowerCase()) ? 1 : -1
        }
      }
      // 未配置自定义 filter 时，沿用 cmdk 默认实现即可。
      return undefined
    }, [creatable, commandProps?.filter])

    // onSearch 存在时不再做本地筛选；仍可通过 commandProps.shouldFilter 显式覆盖。
    return (
      <Command
        ref={dropdownRef}
        {...commandProps}
        onKeyDown={(e) => {
          handleKeyDown(e)
          commandProps?.onKeyDown?.(e)
        }}
        className={cn('h-auto overflow-visible bg-transparent', commandProps?.className)}
        shouldFilter={commandProps?.shouldFilter !== undefined ? commandProps.shouldFilter : !onSearch}
        filter={commandFilter()}
      >
        <div
          className={cn(
            'flex items-start justify-between rounded-md border border-input px-3 py-2 text-base ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 md:text-sm',
            {
              'cursor-text': !disabled && selected.length !== 0
            },
            className
          )}
          onClick={() => {
            if (disabled) return
            inputRef?.current?.focus()
          }}
        >
          <div className="relative flex flex-wrap gap-1">
            {selected.map((option) => {
              return (
                <Badge
                  key={option.value}
                  className={cn(
                    'data-[disabled]:bg-muted-foreground data-[disabled]:text-muted data-[disabled]:hover:bg-muted-foreground',
                    'data-[fixed]:bg-muted-foreground data-[fixed]:text-muted data-[fixed]:hover:bg-muted-foreground',
                    badgeClassName
                  )}
                  data-fixed={option.fixed}
                  data-disabled={disabled || undefined}
                >
                  {option.label}
                  <button
                    type="button"
                    className={cn(
                      'ml-1 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      (disabled || option.fixed) && 'hidden'
                    )}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleUnselect(option)
                      }
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onClick={() => handleUnselect(option)}
                  >
                    <X className="h-3 w-3 hover:text-foreground" />
                  </button>
                </Badge>
              )
            })}
            {/* 设计要求：不展示内置搜索图标 */}
            <CommandPrimitive.Input
              {...inputProps}
              ref={inputRef}
              value={inputValue}
              disabled={disabled}
              onValueChange={(value) => {
                setInputValue(value)
                inputProps?.onValueChange?.(value)
              }}
              onBlur={(event) => {
                if (!onScrollbar) {
                  setOpen(false)
                }
                inputProps?.onBlur?.(event)
              }}
              onFocus={(event) => {
                setOpen(true)
                inputProps?.onFocus?.(event)
              }}
              placeholder={hidePlaceholderWhenSelected && selected.length !== 0 ? '' : placeholder}
              className={cn(
                'flex-1 self-baseline bg-transparent outline-none placeholder:text-muted-foreground',
                {
                  'w-full': hidePlaceholderWhenSelected,
                  'ml-1': selected.length !== 0
                },
                inputProps?.className
              )}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(selected.filter((s) => s.fixed))
              onChange?.(selected.filter((s) => s.fixed))
            }}
            className={cn(
              'flex size-5 items-center justify-center text-muted-foreground/50 hover:text-foreground',
              (hideClearAllButton ||
                disabled ||
                selected.length < 1 ||
                selected.filter((s) => s.fixed).length === selected.length) &&
                'hidden'
            )}
          >
            <X className="size-5" />
          </button>
          <ChevronDownIcon
            className={cn(
              'size-5 text-muted-foreground/50',
              (hideClearAllButton ||
                disabled ||
                selected.length >= 1 ||
                selected.filter((s) => s.fixed).length !== selected.length) &&
                'hidden'
            )}
          />
        </div>
        <div className="relative">
          {open && (
            <CommandList
              className="absolute top-1 z-10 w-full rounded-md border bg-popover text-popover-foreground shadow-md outline-none animate-in"
              onMouseLeave={() => {
                setOnScrollbar(false)
              }}
              onMouseEnter={() => {
                setOnScrollbar(true)
              }}
              onMouseUp={() => {
                inputRef?.current?.focus()
              }}
            >
              {isLoading ? (
                loadingIndicator
              ) : (
                <>
                  {emptyItem()}
                  {creatableItem()}
                  {!selectFirstItem && <CommandItem value="-" className="hidden" />}
                  {Object.entries(selectables).map(([key, dropdowns]) => (
                    <CommandGroup key={key} heading={key} className="h-full overflow-auto">
                      <>
                        {dropdowns.map((option) => {
                          return (
                            <CommandItem
                              key={option.value}
                              value={option.label}
                              disabled={option.disable}
                              onMouseDown={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                              }}
                              onSelect={() => {
                                if (selected.length >= maxSelected) {
                                  onMaxSelected?.(selected.length)
                                  return
                                }
                                setInputValue('')
                                const newOptions = [...selected, option]
                                setSelected(newOptions)
                                onChange?.(newOptions)
                                if (newOptions.length >= maxSelected) {
                                  setOpen(false)
                                  inputRef.current?.blur()
                                }
                              }}
                              className={cn('cursor-pointer', option.disable && 'cursor-default text-muted-foreground')}
                            >
                              {option.label}
                            </CommandItem>
                          )
                        })}
                      </>
                    </CommandGroup>
                  ))}
                </>
              )}
            </CommandList>
          )}
        </div>
      </Command>
    )
  }
)

MultipleSelector.displayName = 'MultipleSelector'
export default MultipleSelector
