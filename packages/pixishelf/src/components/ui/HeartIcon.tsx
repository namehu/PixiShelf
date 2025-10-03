import React from 'react';

export interface HeartIconProps {
  /** 图标尺寸，默认为 24 */
  size?: number;
  /** 图标颜色，默认为 currentColor */
  color?: string;
  /** 是否填充，默认为 false */
  filled?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 点击事件处理器 */
  onClick?: (event: React.MouseEvent<SVGElement>) => void;
  /** 其他 SVG 属性 */
  [key: string]: any;
}

/**
 * 爱心图标组件
 * 支持填充/描边状态、自定义尺寸和颜色
 */
export const HeartIcon: React.FC<HeartIconProps> = ({
  size = 24,
  color = 'currentColor',
  filled = false,
  className = '',
  onClick,
  ...props
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={filled ? 'none' : color}
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`heart-icon ${className}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      {...props}
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
};

export default HeartIcon;