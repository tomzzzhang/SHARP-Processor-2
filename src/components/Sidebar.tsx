import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTab } from './sidebar/DataTab';
import { WellsTab } from './sidebar/WellsTab';
import { AnalysisTab } from './sidebar/AnalysisTab';
import { StyleTab } from './sidebar/StyleTab';
import { SidebarHome } from './sidebar/SidebarHome';
import { useAppState } from '@/hooks/useAppState';

export function Sidebar() {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const hasExperiment = !!experiments[idx];

  return (
    <div className="w-full h-full bg-background flex flex-col overflow-hidden">
      <Tabs defaultValue="data" className="flex flex-col h-full">
        <TabsList
          variant="line"
          className="grid w-full grid-cols-4 shrink-0 rounded-none border-b h-9 px-1 gap-0"
        >
          <TabsTrigger value="data" disabled={!hasExperiment} className={`text-xs font-semibold tracking-wide uppercase after:!bg-[var(--brand-red-mid)] data-active:!text-[var(--brand-red-dark)] ${!hasExperiment ? 'opacity-40 cursor-default' : ''}`}>Data</TabsTrigger>
          <TabsTrigger value="wells" disabled={!hasExperiment} className={`text-xs font-semibold tracking-wide uppercase after:!bg-[var(--brand-red-mid)] data-active:!text-[var(--brand-red-dark)] ${!hasExperiment ? 'opacity-40 cursor-default' : ''}`}>Wells</TabsTrigger>
          <TabsTrigger value="analysis" disabled={!hasExperiment} className={`text-xs font-semibold tracking-wide uppercase after:!bg-[var(--brand-red-mid)] data-active:!text-[var(--brand-red-dark)] ${!hasExperiment ? 'opacity-40 cursor-default' : ''}`}>Analysis</TabsTrigger>
          <TabsTrigger value="style" disabled={!hasExperiment} className={`text-xs font-semibold tracking-wide uppercase after:!bg-[var(--brand-red-mid)] data-active:!text-[var(--brand-red-dark)] ${!hasExperiment ? 'opacity-40 cursor-default' : ''}`}>Style</TabsTrigger>
        </TabsList>
        {!hasExperiment ? (
          <div className="flex-1 overflow-y-auto m-0 p-3">
            <SidebarHome />
          </div>
        ) : (
          <>
            <TabsContent value="data" className="flex-1 overflow-y-auto m-0 p-3">
              <DataTab />
            </TabsContent>
            <TabsContent value="wells" className="flex-1 overflow-y-auto m-0 p-0">
              <WellsTab />
            </TabsContent>
            <TabsContent value="analysis" className="flex-1 overflow-y-auto m-0 p-3">
              <AnalysisTab />
            </TabsContent>
            <TabsContent value="style" className="flex-1 overflow-y-auto m-0 p-3">
              <StyleTab />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
