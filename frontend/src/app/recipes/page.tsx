export default function EmptyRecipeDetailPage() {
  return (
    <div className="text-center text-gray-400 dark:text-gray-600 pb-20">
      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4 border border-gray-200 dark:border-gray-700/50 shadow-sm">
        <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      </div>
      <p className="font-medium text-sm">Select a recipe from the list</p>
      <p className="text-xs mt-1 font-medium opacity-60">View details and start cooking</p>
    </div>
  );
}
