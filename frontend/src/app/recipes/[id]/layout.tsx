import type { Metadata } from 'next';
// import { fetchRecipe } from '@/lib/api'; // Would need server-side auth to work here

type Props = {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // params resolved for future dynamic title; using generic title until server-side fetch is wired
  void params;
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
