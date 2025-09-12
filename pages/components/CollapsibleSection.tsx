import { useState } from 'react';

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export const CollapsibleSection = ({ title, children, defaultOpen = false, className = '' }: CollapsibleSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`bg-card shadow-sm border border-border rounded-xl ${className}`}>
      {/* Header/Toggle Button */}
      <button
        className="w-full flex justify-between items-center p-6 text-left focus:outline-none transition duration-150 hover:bg-gray-50 rounded-xl"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {/* Simple Chevron Icon (SVG) */}
        <svg
          className={`w-5 h-5 text-muted-foreground transform transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content Area */}
      {/* Note: This uses max-height transition for a functional collapse. */}
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
          {/* Add padding and a top border only when open */}
        <div className="p-6 border-t border-border">
            {children}
        </div>
      </div>
    </div>
  );
};
