import { MaintenanceCard } from './_components/maintenance-card'

export default function TasksPage() {
  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">任务计划</h1>
          <p className="text-neutral-600">管理和执行系统后台维护任务</p>
        </div>
        
        <MaintenanceCard />
      </div>
    </div>
  )
}
