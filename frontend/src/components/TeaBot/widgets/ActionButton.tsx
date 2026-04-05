import React from 'react';
import { useCopilotAction } from '@copilotkit/react-core';

export function ActionButton({ label, action, style = 'primary', className = '' }: any) {
  useCopilotAction({
    name: action,
    description: `Execute action ${action}`,
    parameters: [],
    handler: () => {
      // Typically the handler interacts with the shared state.
      console.log(`Action triggered: ${action}`);
    }
  });

  return (
    <button
      onClick={() => console.log(`Triggering action ${action}`)}
      className={`px-4 py-2 mt-2 rounded-lg font-medium text-sm transition-colors shadow-sm active:scale-95 ${
        style === 'primary' 
          ? 'bg-indigo-600 hover:bg-indigo-700 text-white' 
          : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
      } ${className}`}
    >
      {label}
    </button>
  );
}
