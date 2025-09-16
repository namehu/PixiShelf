export default function TestStylesPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-8 text-center">
          TailwindCSS 4 样式测试
        </h1>
        
        {/* 基础颜色测试 */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">基础颜色测试</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-red-500 text-white p-4 rounded-lg text-center">
              红色 (red-500)
            </div>
            <div className="bg-blue-500 text-white p-4 rounded-lg text-center">
              蓝色 (blue-500)
            </div>
            <div className="bg-green-500 text-white p-4 rounded-lg text-center">
              绿色 (green-500)
            </div>
            <div className="bg-yellow-500 text-white p-4 rounded-lg text-center">
              黄色 (yellow-500)
            </div>
          </div>
        </div>
        
        {/* 自定义颜色测试 */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">自定义颜色测试</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-primary text-white p-4 rounded-lg text-center">
              Primary Color
            </div>
            <div className="bg-accent text-white p-4 rounded-lg text-center">
              Accent Color
            </div>
            <div className="bg-neutral-600 text-white p-4 rounded-lg text-center">
              Neutral Color
            </div>
          </div>
        </div>
        
        {/* 响应式测试 */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">响应式测试</h2>
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-purple-100 p-4 rounded text-center">
                <p className="text-sm md:text-base lg:text-lg">响应式文本</p>
              </div>
              <div className="bg-indigo-100 p-4 rounded text-center">
                <p className="text-sm md:text-base lg:text-lg">响应式布局</p>
              </div>
              <div className="bg-pink-100 p-4 rounded text-center">
                <p className="text-sm md:text-base lg:text-lg">响应式间距</p>
              </div>
            </div>
          </div>
        </div>
        
        {/* 动画和效果测试 */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">动画和效果测试</h2>
          <div className="flex flex-wrap gap-4">
            <button className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg transition-colors duration-200">
              悬停效果
            </button>
            <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-3 rounded-lg">
              渐变背景
            </div>
            <div className="bg-white shadow-md hover:shadow-lg transition-shadow duration-200 px-6 py-3 rounded-lg">
              阴影效果
            </div>
          </div>
        </div>
        
        {/* 布局测试 */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">布局测试</h2>
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1 bg-gray-100 p-4 rounded">
                <h3 className="font-semibold mb-2">Flexbox 布局</h3>
                <p className="text-gray-600">这是一个使用 Flexbox 的响应式布局示例。</p>
              </div>
              <div className="flex-1 bg-gray-100 p-4 rounded">
                <h3 className="font-semibold mb-2">响应式设计</h3>
                <p className="text-gray-600">在移动设备上会变成垂直布局。</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="text-center">
          <a 
            href="/" 
            className="inline-block bg-primary hover:bg-primary-600 text-white px-8 py-3 rounded-lg transition-colors duration-200"
          >
            返回首页
          </a>
        </div>
      </div>
    </div>
  )
}