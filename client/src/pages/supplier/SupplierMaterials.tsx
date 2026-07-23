// V2 FIX - AUTH CONTEXT UPDATE
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { SupplierLayout } from "@/components/layout/SupplierLayout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import {
  AlertCircle,
  CheckCircle2,
  Package,
  Plus,
  Loader2,
  MessageSquare,
  Trash2,
} from "lucide-react";

interface MaterialTemplate {
  id: string;
  name: string;
  code: string;
  category?: string;
  subcategory?: string;
  sub_category?: string;
  vendor_category?: string;
  created_at: string;
}

interface Shop {
  id: string;
  name: string;
  location?: string;
  approved?: boolean;
  vendor_category?: string;
}

const UNIT_OPTIONS = ["pcs", "kg", "meter", "sqft", "cum", "litre", "set", "nos"];
const Required = () => <span className="text-red-500 ml-1">*</span>;

export default function SupplierMaterials() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { addSupportMessage, deleteMessage, supportMessages } = useData();
  const [shopName, setShopName] = useState("");
  const [shopLocation, setShopLocation] = useState("");

  // Material Templates State
  const [templates, setTemplates] = useState<MaterialTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templatesSearch, setTemplatesSearch] = useState("");
  const [vendorCategoryFilter, setVendorCategoryFilter] = useState<string>("");

  // Categories State
  const [categories, setCategories] = useState<string[]>([]);
  const [subcategories, setSubcategories] = useState<string[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  // Form State
  const [selectedTemplate, setSelectedTemplate] = useState<MaterialTemplate | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShop, setSelectedShop] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Multiple entries support
  const [entriesList, setEntriesList] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    rate: "",
    unit: "",
    brandname: "",
    modelnumber: "",
    category: "",
    subcategory: "",
    product: "",
    technicalspecification: "",
    dimensions: "",
    finishtype: "",
    metaltype: "",
  });

  const [vendorCategories, setVendorCategories] = useState<string[]>([]);

  useEffect(() => {
    loadMaterialTemplates();
    loadShops();
    loadCategories();
    loadProducts();
    loadSupplierShops();
  }, []);

  const loadSupplierShops = async () => {
    try {
      const token = localStorage.getItem("authToken");
      const response = await fetch("/api/supplier/my-shops", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) return;

      const data = await response.json();
      const supplierShops = data.shops || [];

      const allCats = new Set<string>();
      supplierShops.forEach((s: any) => {
        if (s.vendor_category) {
          s.vendor_category.split(",").forEach((c: string) => allCats.add(c.trim()));
        }
      });
      setVendorCategories(Array.from(allCats));

      const primaryShop = supplierShops.find((s: Shop) => s.approved === true) || supplierShops[0];
      if (primaryShop) {
        setShopName(primaryShop.name);
        setShopLocation(primaryShop.location || "");
        setSelectedShop(primaryShop.id);
      }
    } catch (error) {
      console.error("Error loading supplier shops:", error);
    }
  };

  const loadMaterialTemplates = async () => {
    try {
      const token = localStorage.getItem("authToken");
      const response = await fetch("/api/material-templates", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json();
      setTemplates(data.templates || []);
    } catch (error) {
      console.error("Error loading templates:", error);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const loadShops = async () => {
    try {
      const response = await fetch("/api/shops");
      const data = await response.json();
      setShops(data.shops || []);
    } catch (error) {
      console.error("Error loading shops:", error);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch("/api/material-categories");
      const data = await response.json();
      setCategories(data.categories || []);
    } catch (error) {
      console.error("Error loading categories:", error);
    }
  };

  const loadSubcategories = async (category: string) => {
    if (!category) return setSubcategories([]);
    try {
      const response = await fetch(`/api/material-subcategories/${encodeURIComponent(category)}`);
      const data = await response.json();
      setSubcategories(data.subcategories || []);
    } catch (error) {
      console.error("Error loading subcategories:", error);
    }
  };

  const loadProducts = async () => {
    try {
      const response = await fetch("/api/products");
      const data = await response.json();
      setProducts(data.products || []);
    } catch (error) {
      console.error("Error loading products:", error);
    }
  };

  const handleSelectTemplate = (template: MaterialTemplate) => {
    setSelectedTemplate(template);
    setFormData({
      rate: "",
      unit: "",
      brandname: "",
      modelnumber: "",
      category: template.category || "",
      subcategory: template.subcategory || template.sub_category || "",
      product: "",
      technicalspecification: "",
      dimensions: "",
      finishtype: "",
      metaltype: "",
    });
    if (template.category) loadSubcategories(template.category);
    
    setTimeout(() => {
      document.getElementById("material-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const handleSubmitMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate || !selectedShop || !formData.rate || !formData.unit) {
      toast({ title: "Error", description: "Missing required fields", variant: "destructive" });
      return;
    }

    const toSubmit = entriesList.length > 0 ? entriesList : [{ template_id: selectedTemplate.id, shop_id: selectedShop, ...formData }];
    setSubmitting(true);
    try {
      const token = localStorage.getItem("authToken");
      for (const payload of toSubmit) {
        await fetch("/api/material-submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(payload),
        });
      }
      toast({ title: "Success", description: "Submitted for approval" });
      setSelectedTemplate(null);
      setEntriesList([]);
    } catch (error) {
      toast({ title: "Error", description: "Submission failed", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddEntry = () => {
    if (!selectedTemplate || !selectedShop || !formData.rate || !formData.unit) {
      toast({ title: "Error", description: "Missing required fields", variant: "destructive" });
      return;
    }
    setEntriesList([...entriesList, { template_id: selectedTemplate.id, shop_id: selectedShop, ...formData }]);
    setFormData({ ...formData, rate: "", unit: "", brandname: "", modelnumber: "", subcategory: "", product: "", technicalspecification: "", dimensions: "", finishtype: "", metaltype: "" });
  };

  const handleRemoveEntry = (index: number) => {
    setEntriesList(entriesList.filter((_, i) => i !== index));
  };

  const [location] = useLocation();
  const isSupplier = user?.role === "supplier" || location.startsWith("/supplier");
  const LayoutComponent = isSupplier ? SupplierLayout : Layout;

  return (
    <LayoutComponent {...(isSupplier ? { shopName, shopLocation, shopApproved: true } : {})}>
      <div className="min-h-full bg-[#FDFDFD] w-full">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8 w-full">
          {/* Header Section */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[9px] font-bold uppercase tracking-wider">
                Inventory & Catalog
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Manage Materials
              </h1>
              <p className="text-slate-500 max-w-2xl text-sm font-medium leading-relaxed">
                {isSupplier
                  ? "Select from available material templates, fill in the essentials, and submit for approval"
                  : "Select material templates, fill in all required details, select shop, and submit for approval"
                }
              </p>
            </div>
          </div>

          <div className="grid gap-8">
            {/* Available Templates Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-1.5 bg-blue-50 rounded-lg text-blue-600">
                  <Package size={18} className="w-4.5 h-4.5" strokeWidth={2} />
                </div>
                <h2 className="text-lg font-bold text-slate-900">Available Templates</h2>
                <Badge className="bg-slate-900 text-white text-[10px] font-bold px-1.5 py-0 rounded-sm">{templates.length} Total</Badge>
              </div>

              <div className="space-y-3 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <Label className="text-xs mb-1.5 block font-bold text-slate-700">Search Templates</Label>
                    <Input
                      value={templatesSearch}
                      onChange={(e) => setTemplatesSearch(e.target.value)}
                      placeholder="Search by name or code..."
                      className="h-10 rounded-lg text-sm"
                    />
                  </div>
                  <div className="min-w-0">
                    <Label className="text-xs mb-1.5 block font-bold text-slate-700">Filter by Vendor Category</Label>
                    <Select value={vendorCategoryFilter} onValueChange={setVendorCategoryFilter}>
                      <SelectTrigger className="h-10 rounded-lg text-sm">
                        <SelectValue placeholder="All categories" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from(new Set(
                          user?.role === 'supplier' && vendorCategories.length > 0
                            ? vendorCategories
                            : templates.map(t => t.vendor_category).filter(Boolean)
                        )).map((category: any) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {loadingTemplates ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
              ) : (
                <div className="border border-slate-100 rounded-xl max-h-[400px] overflow-y-auto shadow-sm bg-white divide-y divide-slate-50">
                  {templates
                    .filter(t => (t.name + ' ' + t.code + ' ' + (t.category || '')).toLowerCase().includes(templatesSearch.toLowerCase()))
                    .filter(t => !vendorCategoryFilter || t.vendor_category === vendorCategoryFilter)
                    .map((template) => (
                      <div key={template.id} className="py-2.5 px-5 hover:bg-slate-50 transition-all duration-200 cursor-pointer group flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0 flex items-center gap-2.5">
                          <span className="font-semibold text-slate-900 text-sm truncate">{template.name}</span>
                          <span className="text-[11px] font-medium text-slate-400 flex-shrink-0">({template.code})</span>
                        </div>
                        <Button 
                          size="sm" 
                          className="h-7 px-3 rounded-md text-[11px] font-bold bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border-none"
                          variant="outline" 
                          onClick={(e) => { e.stopPropagation(); handleSelectTemplate(template); }}
                        >
                          Select
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Submission Form Section */}
            {selectedTemplate && (
              <Card id="material-form" className="shadow-sm border-slate-100 bg-white rounded-xl overflow-hidden scroll-mt-20">
                <CardHeader className="border-b border-slate-50 bg-[#FCFDFF] p-6">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-md">
                      <Plus size={20} strokeWidth={2} />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-bold text-slate-900 tracking-tight">
                        Submit Material Details
                      </CardTitle>
                      <CardDescription className="text-[13px] text-slate-500 font-medium">
                        Completing submission for: <span className="text-blue-600 font-semibold">{selectedTemplate.name}</span>
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <form onSubmit={handleSubmitMaterial} className="space-y-8">
                    <div className="space-y-4">
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Outlet & Commercials</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        <div className="space-y-1.5">
                          <Label className="text-slate-700 font-bold text-xs">Outlet Location <Required /></Label>
                          {isSupplier ? (
                            <div className="h-10 flex items-center px-4 bg-slate-50 rounded-lg border border-slate-100 font-semibold text-sm text-slate-900">
                              {shopName || "Loading..."}
                            </div>
                          ) : (
                            <Select value={selectedShop} onValueChange={setSelectedShop}>
                              <SelectTrigger className="h-10 rounded-lg border-slate-200 text-sm">
                                <SelectValue placeholder="Choose outlet" />
                              </SelectTrigger>
                              <SelectContent>
                                {shops.map((shop) => (
                                  <SelectItem key={shop.id} value={shop.id}>{shop.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-slate-700 font-bold text-xs">Standard Rate <Required /></Label>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={formData.rate}
                            onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                            className="h-10 rounded-lg border-slate-200 font-semibold text-sm text-slate-900"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-slate-700 font-bold text-xs">Billing Unit <Required /></Label>
                          <Select value={formData.unit} onValueChange={(val) => setFormData({ ...formData, unit: val })}>
                            <SelectTrigger className="h-10 rounded-lg border-slate-200 text-sm">
                              <SelectValue placeholder="Unit" />
                            </SelectTrigger>
                            <SelectContent>
                              {UNIT_OPTIONS.map((unit) => (
                                <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Additional Information</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="space-y-1.5">
                          <Label className="text-slate-700 font-bold text-xs">Brand / Make</Label>
                          <Input
                            placeholder="Company Name"
                            value={formData.brandname}
                            onChange={(e) => setFormData({ ...formData, brandname: e.target.value })}
                            className="h-10 rounded-lg border-slate-200 text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-slate-700 font-bold text-xs">Model Number</Label>
                          <Input
                            placeholder="Model #"
                            value={formData.modelnumber}
                            onChange={(e) => setFormData({ ...formData, modelnumber: e.target.value })}
                            className="h-10 rounded-lg border-slate-200 text-sm"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-700 font-bold text-xs">Technical Specifications</Label>
                        <Textarea
                          placeholder="Detail the technical parameters..."
                          value={formData.technicalspecification}
                          onChange={(e) => setFormData({ ...formData, technicalspecification: e.target.value })}
                          className="min-h-[80px] rounded-lg border-slate-200 text-sm"
                        />
                      </div>
                    </div>

                    {entriesList.length > 0 && (
                      <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-4">
                        <h4 className="font-bold text-slate-900">Pending Submissions ({entriesList.length})</h4>
                        <div className="space-y-2">
                          {entriesList.map((entry, idx) => (
                            <div key={idx} className="bg-white p-3 rounded-xl border border-slate-100 flex items-center justify-between">
                              <span className="text-sm font-bold text-slate-700">{entry.rate} / {entry.unit} - {entry.brandname || 'No Brand'}</span>
                              <Button size="sm" variant="ghost" onClick={() => handleRemoveEntry(idx)} className="text-red-500 h-8 w-8 p-0">
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="pt-6 border-t border-slate-50 flex flex-wrap gap-3">
                      <Button
                        type="submit"
                        disabled={submitting}
                        className="bg-slate-900 hover:bg-slate-800 text-white font-bold h-11 px-8 rounded-lg shadow-sm transition-all active:scale-95 text-sm"
                      >
                        {submitting ? <Loader2 className="animate-spin mr-2" /> : "Submit for Approval"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleAddEntry}
                        className="h-11 px-8 rounded-lg border border-slate-200 font-bold hover:bg-slate-50 text-sm"
                      >
                        Add to Queue
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setSelectedTemplate(null)}
                        className="h-11 px-6 rounded-lg text-slate-400 font-bold text-sm"
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </LayoutComponent>
  );
}
