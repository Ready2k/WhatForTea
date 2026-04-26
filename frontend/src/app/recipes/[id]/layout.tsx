import type { Metadata } from 'next';
// import { fetchRecipe } from '@/lib/api'; // Would need server-side auth to work here

type Props = {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  
  // Note: This might need a server-side fetcher if getRecipeSummary is client-only
  // For now, let's assume we can fetch it or just use a generic title
  return {
    title: `Recipe | WhatsForTea`,
    openGraph: {
      title: `Recipe | WhatsForTea`,
      description: 'Check out this recipe on WhatsForTea!',
      type: 'website',
    },
  };
}

export default function RecipeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
