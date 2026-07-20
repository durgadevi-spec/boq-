import React, { useState, useMemo } from 'react';
import { Search, Edit, Trash2, ShieldCheck, History, Clock, FileText, CheckCircle2, AlertTriangle, Layers, Maximize2, X, Activity } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { format, differenceInDays } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface AllMaterialsSplitViewProps {
  materials: any[]; localShops: any[]; categories: string[];
  getSubCategoriesForCategory: (cat: string) => any[]; products: any[]; UNIT_OPTIONS: string[];
  materialSearch: string; setMaterialSearch: (v: string) => void;
  materialCategoryFilter: string; setMaterialCategoryFilter: (v: string) => void;
  materialSubcategoryFilter: string; setMaterialSubcategoryFilter: (v: string) => void;
  editingMaterialId: string | null; setEditingMaterialId: (id: string | null) => void;
  newMaterial: any; setNewMaterial: (mat: any) => void; handleUpdateMaterial: () => void;
  onToggleDisable: (mat: any) => void; onDelete: (mat: any) => void;
  canEditDelete: boolean; userRole: string;
}

export function AllMaterialsSplitView({ materials, localShops, categories, getSubCategoriesForCategory, products, UNIT_OPTIONS, materialSearch, setMaterialSearch, materialCategoryFilter, setMaterialCategoryFilter, materialSubcategoryFilter, setMaterialSubcategoryFilter, editingMaterialId, setEditingMaterialId, newMaterial, setNewMaterial, handleUpdateMaterial, onToggleDisable, onDelete, canEditDelete, userRole }: AllMaterialsSplitViewProps) {
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const selectedMaterial = useMemo(() => materials.find(m => m.id === selectedMaterialId) || null, [materials, selectedMaterialId]);
  const mockBOMUsage = useMemo(() => [
    { id: 1, bomName: "BOM-HQ-Phase1", project: "Headquarters Build", qty: 450, unit: selectedMaterial?.unit || 'pcs', date: "2026-03-15", status: "Approved", section: "Civil" },
    { id: 2, bomName: "BOM-Retail-A", project: "Retail Store Expansion", qty: 120, unit: selectedMaterial?.unit || 'pcs', date: "2026-04-02", status: "Pending", section: "Interior" }
  ], [selectedMaterial]);
  const mockBOQUsage = useMemo(() => [{ id: 1, boqName: "BOQ-Office-Reno", project: "Office Renovation", qty: 300, unit: selectedMaterial?.unit || 'pcs', date: "2026-01-20", status: "Finalized", section: "Fitout" }], [selectedMaterial]);
  const mockHistory = useMemo(() => [
    { id: 1, action: "Rate updated", from: "₹1,200", to: "₹1,250", by: "Admin User", date: "2026-05-01T10:30:00" },
    { id: 2, action: "Vendor changed", from: "Shop A", to: "Shop B", by: "Purchase Team", date: "2026-02-15T14:20:00" },
    { id: 3, action: "Material created", from: "", to: "", by: "Admin User", date: selectedMaterial?.created_at || "2025-11-10T09:00:00" }
  ], [selectedMaterial]);

  return (
    <div className={`flex flex-col md:flex-row border rounded-xl overflow-hidden bg-background shadow-sm transition-all duration-300 ${isFullScreen ? 'fixed inset-4 z-50 shadow-2xl' : 'h-[800px]'}`}>
      <div className={`flex flex-col bg-slate-50/50 transition-all duration-300 ${!selectedMaterial ? 'w-full' : (isFullScreen ? 'w-1/4 border-r' : 'w-full md:w-1/3 min-w-[300px] border-r')}`}>
        <div className="p-4 border-b bg-white space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-slate-800 uppercase tracking-wider">Materials ({materials.length})</h3>
            <Button variant="ghost" size="icon" onClick={() => setIsFullScreen(!isFullScreen)} className="h-8 w-8 hidden md:flex text-slate-500 hover:text-slate-800">{isFullScreen ? <X className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input value={materialSearch} onChange={(e) => setMaterialSearch(e.target.value)} placeholder="Search materials..." className="pl-9 h-9 bg-slate-50/50 border-slate-200 focus-visible:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={materialCategoryFilter} onValueChange={(val) => { setMaterialCategoryFilter(val); setMaterialSubcategoryFilter('all'); }}>
              <SelectTrigger className="h-8 text-xs bg-slate-50/50"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent className="max-h-60">
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="uncategorized" className="text-red-500">Uncategorized</SelectItem>
                {categories?.map((cat) => (<SelectItem key={cat} value={cat}>{cat}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={materialSubcategoryFilter} onValueChange={setMaterialSubcategoryFilter} disabled={materialCategoryFilter === 'all'}>
              <SelectTrigger className="h-8 text-xs bg-slate-50/50"><SelectValue placeholder="Subcategory" /></SelectTrigger>
              <SelectContent className="max-h-60">
                <SelectItem value="all">All Subcategories</SelectItem>
                <SelectItem value="uncategorized" className="text-red-500">Uncategorized</SelectItem>
                {materialCategoryFilter !== 'all' && materialCategoryFilter !== 'uncategorized' && getSubCategoriesForCategory(materialCategoryFilter).map((sub: any) => (<SelectItem key={sub.id || sub.name} value={sub.name}>{sub.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <ScrollArea className="flex-1">
          {materials.length === 0 ? (
            <div className="p-8 text-center text-slate-500 flex flex-col items-center"><Layers className="h-10 w-10 text-slate-300 mb-3" /><p className="text-sm">No materials found</p></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {!selectedMaterial && materials.length > 0 && (
                <div className="flex items-center justify-between w-full px-4 py-3 bg-slate-100/80 border-b text-[10px] font-bold text-slate-500 uppercase tracking-wider sticky top-0 z-10 backdrop-blur-sm">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-20 shrink-0 text-center">Code</div>
                    <div className="flex-1">Material Name</div>
                    <div className="w-48 truncate hidden md:block">Category</div>
                    <div className="w-48 truncate hidden lg:block">Assigned Vendor</div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="w-16 text-right hidden sm:block">Unit</div>
                    <div className="w-24 text-right">Rate</div>
                  </div>
                </div>
              )}
              {materials.map((mat) => (
                <div key={mat.id} onClick={() => { setSelectedMaterialId(mat.id); if (editingMaterialId !== mat.id) { setEditingMaterialId(null); } }} className={`cursor-pointer transition-all hover:bg-blue-50/50 border-l-4 ${selectedMaterialId === mat.id ? 'bg-blue-50 border-blue-500' : 'border-transparent bg-white'} ${!selectedMaterial ? 'p-3 hover:shadow-sm' : 'p-4'}`}>
                  {!selectedMaterial ? (
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-4 flex-1">
                        <Badge variant="outline" className="text-[10px] font-medium uppercase px-1.5 py-0.5 bg-slate-50 w-20 justify-center shrink-0 border-slate-200">{mat.code || 'N/A'}</Badge>
                        <h4 className="font-semibold text-sm text-slate-800 line-clamp-1 flex-1">{mat.name}</h4>
                        <span className="text-xs text-slate-500 w-48 truncate hidden md:block">{mat.category || 'No Category'}</span>
                        <span className="text-xs text-slate-500 w-48 truncate hidden lg:block">{localShops.find(s => s.id === (mat.shopId || mat.shop_id))?.name || 'Unassigned'}</span>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <span className="text-xs text-slate-500 w-16 text-right font-medium hidden sm:block">{mat.unit || '-'}</span>
                        <span className="text-sm font-bold text-green-600 w-24 text-right">₹{Number(mat.rate || 0).toLocaleString()}</span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="font-semibold text-sm text-slate-900 line-clamp-1">{mat.name}</h4>
                        <span className="text-xs font-bold text-green-600 shrink-0 ml-2">₹{Number(mat.rate || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center text-xs text-slate-500 mb-2 gap-2">
                        <Badge variant="outline" className="text-[10px] font-medium uppercase px-1.5 py-0 bg-slate-100">{mat.code || 'N/A'}</Badge>
                        <span className="truncate">{mat.category || 'No Category'}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center justify-between">
                        <span>{localShops.find(s => s.id === (mat.shopId || mat.shop_id))?.name || 'Unassigned'}</span>
                        <span>{mat.unit || '-'}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {selectedMaterial && (
        <div className="flex-1 bg-white flex flex-col overflow-hidden relative shadow-[-10px_0_15px_-3px_rgba(0,0,0,0.05)] animate-in slide-in-from-right-8 duration-300 z-10 border-l border-slate-200">
          {editingMaterialId === selectedMaterial.id ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="p-4 md:p-6 border-b bg-slate-50/80 flex items-center justify-between shrink-0">
                <div><h2 className="text-xl font-bold text-slate-800">Edit Material</h2><p className="text-sm text-slate-500">{selectedMaterial.name} ({selectedMaterial.code})</p></div>
                <Button variant="ghost" size="sm" onClick={() => setEditingMaterialId(null)}><X className="h-4 w-4 mr-2" /> Cancel</Button>
              </div>
              <ScrollArea className="flex-1 p-4 md:p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 max-w-4xl mx-auto">
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Material Name</Label><Input value={newMaterial.name || ''} onChange={(e) => setNewMaterial({ ...newMaterial, name: e.target.value })} className="h-9" /></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Material Code</Label><Input value={newMaterial.code || ''} onChange={(e) => setNewMaterial({ ...newMaterial, code: e.target.value })} className="h-9" /></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Rate (₹)</Label><Input type="number" onWheel={(e) => (e.target as HTMLInputElement).blur()} value={newMaterial.rate ?? ''} onChange={(e) => setNewMaterial({ ...newMaterial, rate: e.target.value })} className="h-9" /></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Unit of Measurement</Label><Select value={newMaterial.unit || ''} onValueChange={(v) => setNewMaterial({ ...newMaterial, unit: v })}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent className="max-h-60"><ScrollArea className="h-60">{UNIT_OPTIONS.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}</ScrollArea></SelectContent></Select></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Category</Label><Select value={newMaterial.category || ''} onValueChange={(v) => setNewMaterial({ ...newMaterial, category: v, subCategory: '' })}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent className="max-h-60">{categories.map((c: string) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}</SelectContent></Select></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Sub Category</Label><Select value={newMaterial.subCategory || ''} onValueChange={(v) => setNewMaterial({ ...newMaterial, subCategory: v })}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent className="max-h-60">{getSubCategoriesForCategory(newMaterial.category || '').map((sc: any) => (<SelectItem key={sc.id} value={sc.name}>{sc.name}</SelectItem>))}</SelectContent></Select></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Product</Label><Select value={newMaterial.product || ''} onValueChange={(v) => setNewMaterial({ ...newMaterial, product: v })}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent className="max-h-60">{products.filter((p: any) => (p.subcategory || p.subcategory_name || "").toLowerCase().trim() === (newMaterial.subCategory || "").toLowerCase().trim()).map((p: any) => (<SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>))}</SelectContent></Select></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Assigned Vendor / Shop</Label><Select value={newMaterial.shopId || ''} onValueChange={(v) => setNewMaterial({ ...newMaterial, shopId: v })}><SelectTrigger className="h-9"><SelectValue placeholder="Select Shop" /></SelectTrigger><SelectContent className="max-h-60">{localShops.map((s: any) => (<SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>))}</SelectContent></Select></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Brand Name</Label><Input value={newMaterial.brandName || ''} onChange={(e) => setNewMaterial({ ...newMaterial, brandName: e.target.value })} className="h-9" /></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Model Number</Label><Input value={newMaterial.modelNumber || ''} onChange={(e) => setNewMaterial({ ...newMaterial, modelNumber: e.target.value })} className="h-9" /></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Dimensions</Label><Input value={newMaterial.dimensions || ''} onChange={(e) => setNewMaterial({ ...newMaterial, dimensions: e.target.value })} placeholder="L x W x H" className="h-9" /></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Finish / Texture</Label><Input value={newMaterial.finish || ''} onChange={(e) => setNewMaterial({ ...newMaterial, finish: e.target.value })} className="h-9" /></div>
                  <div className="space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Material Type (e.g. Steel)</Label><Input value={newMaterial.metalType || ''} onChange={(e) => setNewMaterial({ ...newMaterial, metalType: e.target.value })} className="h-9" /></div>
                  <div className="col-span-1 md:col-span-2 space-y-2"><Label className="text-xs font-semibold uppercase text-slate-500">Technical Specification</Label><Textarea value={newMaterial.technicalSpecification || ''} onChange={(e) => setNewMaterial({ ...newMaterial, technicalSpecification: e.target.value })} rows={4} className="resize-none" /></div>
                </div>
              </ScrollArea>
              <div className="p-4 border-t bg-slate-50/50 flex justify-end gap-3 shrink-0">
                <Button variant="outline" onClick={() => setEditingMaterialId(null)}>Cancel</Button>
                <Button onClick={handleUpdateMaterial} className="bg-blue-600 hover:bg-blue-700">Save Changes</Button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="px-6 py-5 border-b bg-white shrink-0 relative">
                <Button variant="ghost" size="icon" onClick={() => setSelectedMaterialId(null)} className="absolute right-4 top-4 h-8 w-8 text-slate-400 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 rounded-full transition-colors"><X className="h-4 w-4" /></Button>
                <div className="flex justify-between items-start mb-4 pr-10">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-2xl font-bold text-slate-900">{selectedMaterial.name}</h2>
                      {selectedMaterial.disabled && <Badge variant="destructive" className="uppercase text-[10px]">Disabled</Badge>}
                    </div>
                    <p className="text-slate-500 font-medium">SKU/Code: {selectedMaterial.code || 'N/A'}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-green-600 tracking-tight">₹{Number(selectedMaterial.rate || 0).toLocaleString()}</div>
                    <div className="text-sm text-slate-500 font-medium">per {selectedMaterial.unit || 'unit'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  {(canEditDelete || userRole === "pre_sales") && (
                    <Button size="sm" variant="outline" onClick={() => { setEditingMaterialId(selectedMaterial.id); setNewMaterial({ name: selectedMaterial.name || '', code: selectedMaterial.code || '', rate: selectedMaterial.rate || 0, unit: selectedMaterial.unit || 'pcs', category: selectedMaterial.category || '', subCategory: selectedMaterial.subcategory || selectedMaterial.subCategory || selectedMaterial.sub_category || '', product: selectedMaterial.product || '', brandName: selectedMaterial.brandName || selectedMaterial.brand || '', modelNumber: selectedMaterial.modelNumber || selectedMaterial.model || '', technicalSpecification: selectedMaterial.technicalSpecification || selectedMaterial.technicalspecification || '', dimensions: selectedMaterial.dimensions || '', finish: selectedMaterial.finish || selectedMaterial.finishtype || '', metalType: selectedMaterial.metalType || selectedMaterial.materialtype || '', shopId: selectedMaterial.shopId || selectedMaterial.shop_id || '' }); }} className="h-8 gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50"><Edit className="h-3.5 w-3.5" /> Edit Material</Button>
                  )}
                  {canEditDelete && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => onToggleDisable(selectedMaterial)} className="h-8">{selectedMaterial.disabled ? 'Enable Item' : 'Disable Item'}</Button>
                      <Button size="icon" variant="outline" onClick={() => onDelete(selectedMaterial)} className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 border-red-200"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </>
                  )}
                </div>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="w-full justify-start bg-transparent border-b rounded-none h-auto p-0 space-x-6">
                    {['overview', 'bom_usage', 'boq_usage', 'history', 'audit'].map(tab => (
                      <TabsTrigger key={tab} value={tab} className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1 py-3 text-sm font-medium capitalize data-[state=active]:text-blue-600 text-slate-500 hover:text-slate-700">{tab.replace('_', ' ')}</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              <ScrollArea className="flex-1 bg-slate-50/50">
                <div className="p-6">
                  {activeTab === 'overview' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <Card className="shadow-sm border-slate-200">
                        <CardContent className="p-0">
                          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100">
                            <div className="p-4 space-y-1"><span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Category</span><p className="text-sm font-medium text-slate-800">{selectedMaterial.category || 'N/A'}</p></div>
                            <div className="p-4 space-y-1"><span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Subcategory</span><p className="text-sm font-medium text-slate-800">{selectedMaterial.subcategory || selectedMaterial.subCategory || 'N/A'}</p></div>
                            <div className="p-4 space-y-1"><span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Product Link</span><p className="text-sm font-medium text-blue-600 cursor-pointer hover:underline">{selectedMaterial.product || 'Not Linked'}</p></div>
                            <div className="p-4 space-y-1"><span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Vendor / Shop</span><p className="text-sm font-medium text-slate-800">{localShops.find(s => s.id === (selectedMaterial.shopId || selectedMaterial.shop_id))?.name || 'Unassigned'}</p></div>
                          </div>
                        </CardContent>
                      </Card>
                      <div>
                        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2"><FileText className="h-4 w-4 text-slate-400" /> Material Specifications</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-4">
                            <div className="flex flex-col"><span className="text-xs text-slate-500 mb-1">Brand Name</span><span className="text-sm font-medium">{selectedMaterial.brandName || selectedMaterial.brand || '-'}</span></div>
                            <div className="flex flex-col"><span className="text-xs text-slate-500 mb-1">Model Number</span><span className="text-sm font-medium">{selectedMaterial.modelNumber || selectedMaterial.model || '-'}</span></div>
                            <div className="flex flex-col"><span className="text-xs text-slate-500 mb-1">Dimensions (L x W x H)</span><span className="text-sm font-medium">{selectedMaterial.dimensions || '-'}</span></div>
                            <div className="flex flex-col"><span className="text-xs text-slate-500 mb-1">HSN Code</span><span className="text-sm font-medium">{selectedMaterial.hsnCode || selectedMaterial.hsn_code || selectedMaterial.template_hsn_code || '-'}</span></div>
                          </div>
                          <div className="space-y-4">
                            <div className="flex flex-col"><span className="text-xs text-slate-500 mb-1">Finish Type</span><span className="text-sm font-medium">{selectedMaterial.finish || selectedMaterial.finishtype || '-'}</span></div>
                            <div className="flex flex-col"><span className="text-xs text-slate-500 mb-1">Material Composition</span><span className="text-sm font-medium">{selectedMaterial.metalType || selectedMaterial.materialtype || '-'}</span></div>
                            <div className="flex flex-col"><span className="text-xs text-slate-500 mb-1">SAC Code</span><span className="text-sm font-medium">{selectedMaterial.sacCode || selectedMaterial.sac_code || selectedMaterial.template_sac_code || '-'}</span></div>
                            <div className="flex flex-col">
                              <span className="text-xs text-slate-500 mb-1">Last Rate Update</span>
                              <div className={`text-sm font-medium flex items-center gap-1.5 ${!selectedMaterial.created_at ? 'text-slate-500' : differenceInDays(new Date(), new Date(selectedMaterial.created_at)) > 90 ? 'text-amber-600' : 'text-green-600'}`}>
                                {selectedMaterial.created_at ? (<>{differenceInDays(new Date(), new Date(selectedMaterial.created_at)) > 90 ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{format(new Date(selectedMaterial.created_at), 'dd MMM yyyy')} ({differenceInDays(new Date(), new Date(selectedMaterial.created_at))} days ago)</>) : 'Date not recorded'}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <Separator />
                      <div>
                        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-slate-400" /> Technical Details</h3>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4"><p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{selectedMaterial.technicalSpecification || selectedMaterial.technicalspecification || 'No technical specifications provided for this material.'}</p></div>
                      </div>
                    </div>
                  )}
                  {activeTab === 'bom_usage' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-slate-800">Used in {mockBOMUsage.length} BOMs</h3></div>
                      <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-bold"><tr><th className="px-4 py-3">BOM Name</th><th className="px-4 py-3">Project</th><th className="px-4 py-3 text-right">Qty Used</th><th className="px-4 py-3">Date Added</th><th className="px-4 py-3">Status</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {mockBOMUsage.map(usage => (
                              <tr key={usage.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-3 font-medium text-blue-600 cursor-pointer hover:underline">{usage.bomName}</td>
                                <td className="px-4 py-3 text-slate-700">{usage.project}</td>
                                <td className="px-4 py-3 text-right font-bold">{usage.qty} {usage.unit}</td>
                                <td className="px-4 py-3 text-slate-500">{format(new Date(usage.date), 'dd MMM yyyy')}</td>
                                <td className="px-4 py-3"><Badge variant={usage.status === 'Approved' ? 'default' : 'secondary'} className="bg-green-100 text-green-700 hover:bg-green-100 border-transparent text-[10px]">{usage.status}</Badge></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {activeTab === 'boq_usage' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-slate-800">Used in {mockBOQUsage.length} BOQs</h3></div>
                      <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-bold"><tr><th className="px-4 py-3">BOQ Name</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Linked Section</th><th className="px-4 py-3 text-right">Est. Qty</th><th className="px-4 py-3">Status</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {mockBOQUsage.map(usage => (
                              <tr key={usage.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-3 font-medium text-blue-600 cursor-pointer hover:underline">{usage.boqName}</td>
                                <td className="px-4 py-3 text-slate-700">{usage.project}</td>
                                <td className="px-4 py-3 text-slate-500">{usage.section}</td>
                                <td className="px-4 py-3 text-right font-bold">{usage.qty} {usage.unit}</td>
                                <td className="px-4 py-3"><Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50 text-[10px]">{usage.status}</Badge></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {activeTab === 'history' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-2xl">
                      <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Activity className="h-4 w-4 text-slate-400" /> Modification Timeline</h3>
                      <div className="relative border-l-2 border-slate-100 ml-3 space-y-8">
                        {mockHistory.map((item, i) => (
                          <div key={item.id} className="relative pl-6">
                            <span className={`absolute -left-[9px] top-1 h-4 w-4 rounded-full border-4 border-white ${i === 0 ? 'bg-blue-500' : 'bg-slate-300'}`} />
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-slate-800">{item.action}</span>
                              {item.from || item.to ? (<span className="text-sm text-slate-500 mt-1">Changed from <span className="line-through">{item.from}</span> to <span className="font-semibold text-slate-700">{item.to}</span></span>) : null}
                              <div className="flex items-center gap-2 mt-2 text-xs text-slate-400 font-medium"><span>By {item.by}</span><span>•</span><Clock className="h-3 w-3" /><span>{format(new Date(item.date), 'dd MMM yyyy, HH:mm')}</span></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {activeTab === 'audit' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <Card className="border-slate-200 shadow-sm">
                        <CardContent className="p-6 space-y-6">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                            <div><p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Created By</p><p className="text-sm font-medium text-slate-800">System Admin</p></div>
                            <div><p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Creation Date</p><p className="text-sm font-medium text-slate-800">{selectedMaterial.created_at ? format(new Date(selectedMaterial.created_at), 'dd MMM yyyy') : 'Unknown'}</p></div>
                            <div><p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Last Modified By</p><p className="text-sm font-medium text-slate-800">Purchase Team User</p></div>
                            <div><p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Approval Status</p><Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none shadow-none mt-1">Approved</Badge></div>
                          </div>
                          <Separator />
                          <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">System Identifiers</p>
                            <div className="bg-slate-50 p-4 rounded-md font-mono text-xs text-slate-600 grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div><span className="text-slate-400">UUID:</span> {selectedMaterial.id}</div>
                              <div><span className="text-slate-400">Template ID:</span> {selectedMaterial.template_id || 'N/A'}</div>
                              <div><span className="text-slate-400">Shop Ref:</span> {selectedMaterial.shopId || selectedMaterial.shop_id || 'None'}</div>
                              <div><span className="text-slate-400">Data Source:</span> Master Materials Import</div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      )}
    </div>
  );
}