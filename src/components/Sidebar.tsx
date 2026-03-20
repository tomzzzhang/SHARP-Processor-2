import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTab } from './sidebar/DataTab';
import { WellsTab } from './sidebar/WellsTab';
import { AnalysisTab } from './sidebar/AnalysisTab';
import { StyleTab } from './sidebar/StyleTab';

export function Sidebar() {
  return (
    <div className="w-full h-full bg-background flex flex-col overflow-hidden">
      <Tabs defaultValue="data" className="flex flex-col h-full">
        <TabsList className="grid w-full grid-cols-4 shrink-0 rounded-none border-b">
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="wells">Wells</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="style">Style</TabsTrigger>
        </TabsList>
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
      </Tabs>
    </div>
  );
}
