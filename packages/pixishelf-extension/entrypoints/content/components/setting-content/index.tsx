import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { HelpCircle } from 'lucide-react'
import { useSettingStore } from '../../stores/setting-store'
import { ETagDownloadMode, MTagDownloadMode, OTagDownloadMode } from '@/enums/ETagDownloadMode'
import { toast } from 'sonner'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'

export const SettingContent: React.FC = () => {
  const { tagDownloadMode, customDirectory, updateTagDownloadMode, updateCustomDirectory } = useSettingStore()

  return (
    <TooltipProvider>
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="download-settings">
          <AccordionTrigger className="text-left">下载设置</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-6">
              {/* 下载模式设置 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="flex items-center gap-2">
                  <Label htmlFor="download-mode" className="text-sm font-medium">
                    下载模式
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>选择图片的下载方式：</p>
                      <p>{MTagDownloadMode[ETagDownloadMode.Zip]}: 将所有图片打包为一个ZIP文件下载</p>
                      <p>{MTagDownloadMode[ETagDownloadMode.Individual]}: 每个图片单独下载，文件名包含标签前缀</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="md:col-span-2">
                  <Select
                    value={tagDownloadMode}
                    onValueChange={(va: any) => {
                      updateTagDownloadMode(va)
                      toast.success('下载模式已更新')
                    }}
                  >
                    <SelectTrigger id="download-mode" className="w-full">
                      <SelectValue placeholder="选择下载模式" />
                    </SelectTrigger>
                    <SelectContent>
                      {OTagDownloadMode.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value}>
                          {mode.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 自定义目录设置 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="flex items-center gap-2">
                  <Label htmlFor="custom-directory" className="text-sm font-medium">
                    自定义目录
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>留空则下载到默认Downloads文件夹</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="md:col-span-2">
                  <InputGroup>
                    <InputGroupAddon>
                      <InputGroupText>Downloads/</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      placeholder="tags"
                      className="!pl-1"
                      value={customDirectory}
                      onChange={(e) => {
                        updateCustomDirectory((e.target.value ?? '').trim())
                      }}
                      onBlur={(e) => {
                        toast.success('自定义目录已更新')
                      }}
                    />
                  </InputGroup>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </TooltipProvider>
  )
}
