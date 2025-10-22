import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

export const SettingContent: React.FC = () => {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="item-1">
        <AccordionTrigger>标签设置</AccordionTrigger>
        <AccordionContent>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="download-mode">下载模式:</label>
              <select id="download-mode" className="px-2 py-1 border border-[#ccc] rounded">
                <option value="zip">ZIP打包</option>
                <option value="single">单独文件</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="custom-directory">自定义目录:</label>
              <input id="custom-directory" type="text" className="px-2 py-1 border border-[#ccc] rounded" />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
