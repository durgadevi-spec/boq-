import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { SupplierLayout } from "@/components/layout/SupplierLayout";
import { useAuth } from "@/lib/auth-context";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Building2, Plus, Check, ChevronsUpDown, X, Store, MapPin, Phone, Globe, FileText, IndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const COUNTRY_CODES = [
  { code: "+91", country: "India" },
  { code: "+1", country: "USA" },
  { code: "+44", country: "UK" },
  { code: "+61", country: "Australia" },
  { code: "+971", country: "UAE" },
  { code: "+81", country: "Japan" },
  { code: "+49", country: "Germany" },
];

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"
];

const Required = () => <span className="text-red-500 ml-0.5 text-xs">*</span>;

export default function SupplierShops() {
  const { toast } = useToast();
  const [shops, setShops] = useState<any[]>([]);
  const [dbCategories, setDbCategories] = useState<any[]>([]);
  const [loadingShops, setLoadingShops] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingShopId, setEditingShopId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    location: "",
    city: "",
    phoneCountryCode: "+91",
    contactNumber: "",
    state: "Tamil Nadu",
    country: "India",
    pincode: "",
    gstNo: "",
    new_location: "",
    terms_and_conditions: "",
    vendor_category: [] as string[],
  });

  // Load supplier's shops and categories on mount
  useEffect(() => {
    loadSupplierShops();
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await fetch("/api/vendor-categories");
      if (response.ok) {
        const data = await response.json();
        setDbCategories(data.categories || []);
      }
    } catch (error) {
      console.error("Error fetching categories:", error);
    }
  };

  const loadSupplierShops = async () => {
    try {
      const token = localStorage.getItem("authToken");
      const response = await fetch("/api/supplier/my-shops", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        setShops([]);
        return;
      }
      const data = await response.json();
      setShops(data.shops || []);
    } catch (error) {
      console.error("Error loading shops:", error);
      setShops([]);
    } finally {
      setLoadingShops(false);
    }
  };

  const handleSubmitShop = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({ title: "Error", description: "Shop name is required", variant: "destructive" });
      return;
    }

    if (!formData.location.trim() || !formData.city.trim()) {
      toast({ title: "Error", description: "City and Address are required", variant: "destructive" });
      return;
    }

    if (!formData.contactNumber.trim()) {
      toast({ title: "Error", description: "Contact number is required", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const token = localStorage.getItem("authToken");
      const url = editingShopId ? `/api/shops/${editingShopId}` : "/api/shops";
      const method = editingShopId ? "PUT" : "POST";
      
      const payload = {
        ...formData,
        vendor_category: formData.vendor_category.join(", "),
        vendorCategory: formData.vendor_category.join(", "), // For PUT route mapping
      };

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to submit shop (${response.status})`);
      }

      toast({
        title: "Success",
        description: editingShopId ? "Shop updated successfully." : "Shop submitted successfully.",
      });

      resetForm();
      loadSupplierShops();
    } catch (error) {
      console.error("Error submitting shop:", error);
      toast({ title: "Error", description: "Failed to submit shop", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      location: "",
      city: "",
      phoneCountryCode: "+91",
      contactNumber: "",
      state: "Tamil Nadu",
      country: "India",
      pincode: "",
      gstNo: "",
      new_location: "",
      terms_and_conditions: "",
      vendor_category: [],
    });
    setEditingShopId(null);
    setShowForm(false);
  };

  const startEdit = (shop: any) => {
    setFormData({
      name: shop.name || "",
      location: shop.location || "",
      city: shop.city || "",
      phoneCountryCode: shop.phoneCountryCode || "+91",
      contactNumber: shop.contactNumber || "",
      state: shop.state || "Tamil Nadu",
      country: shop.country || "India",
      pincode: shop.pincode || "",
      gstNo: shop.gstNo || shop.gstno || "",
      new_location: shop.new_location || "",
      terms_and_conditions: shop.terms_and_conditions || "",
      vendor_category: shop.vendor_category ? shop.vendor_category.split(",").map((s: string) => s.trim()) : [],
    });
    setEditingShopId(shop.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

    const { user } = useAuth();
    const isSupplier = user?.role === "supplier";
    const shopName = shops[0]?.name || "";
    const shopLocation = shops[0]?.location || "";
    const LayoutComponent = isSupplier ? SupplierLayout : Layout;

    return (
      <LayoutComponent {...(isSupplier ? { shopName, shopLocation, shopApproved: true } : {})}>
      <div className="min-h-screen bg-[#FDFDFD]">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[9px] font-bold uppercase tracking-wider">
                Retail Outlets
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Shop Management
              </h1>
              <p className="text-slate-500 max-w-2xl text-sm font-medium leading-relaxed">
                Register and update your commercial outlets. Ensure all registration details are accurate for verification.
              </p>
            </div>
            {!showForm && (
              <Button
                onClick={() => setShowForm(true)}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-5 h-10 shadow-sm rounded-lg flex items-center gap-2 group transition-all text-sm"
              >
                <Plus className="h-4 w-4 group-hover:rotate-90 transition-transform duration-300" /> 
                Add New Shop
              </Button>
            )}
          </div>

        <div className="grid gap-10">
          {showForm && (
            <Card className="border-slate-200 shadow-lg overflow-hidden rounded-xl animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="bg-slate-50 border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    {editingShopId ? "Edit Regional Outlet" : "Register New Shop Outlet"}
                  </h2>
                  <p className="text-[10px] text-slate-500">All fields marked with <Required /> are mandatory</p>
                </div>
                <Button variant="ghost" size="sm" onClick={resetForm} className="text-slate-400 hover:text-slate-600 h-8 w-8 p-0">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardContent className="p-6">
                <form onSubmit={handleSubmitShop} className="space-y-6">
                  {/* Basic Information */}
                  <div className="space-y-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b pb-1.5">Technical Information</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-bold text-slate-700">Official Shop Name <Required /></Label>
                        <Input
                          placeholder="e.g. Galaxy Hardware"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="h-10 border-slate-200 focus:border-slate-400 focus:ring-0 rounded-lg text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-bold text-slate-700">Primary Contact Number <Required /></Label>
                        <div className="flex gap-2">
                          <Select
                            value={formData.phoneCountryCode}
                            onValueChange={(val) => setFormData({ ...formData, phoneCountryCode: val })}
                          >
                            <SelectTrigger className="w-[80px] h-10 border-slate-200 rounded-lg text-sm">
                              <SelectValue placeholder="+91" />
                            </SelectTrigger>
                            <SelectContent>
                              {COUNTRY_CODES.map((c) => (
                                <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            placeholder="98765 43210"
                            value={formData.contactNumber}
                            onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                            type="tel"
                            className="flex-1 h-10 border-slate-200 focus:border-slate-400 focus:ring-0 rounded-lg text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Vendor Categories */}
                  <div className="space-y-6">
                    <p className="text-sm font-bold uppercase tracking-wider text-slate-400 border-b pb-2">Scope of Operations</p>
                    <div className="space-y-2.5">
                      <Label className="text-xs font-bold text-slate-700">Vendor Categories <Required /></Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-full h-11 justify-between border-slate-200 hover:border-slate-300 rounded-lg text-slate-600 bg-white"
                          >
                            <div className="flex flex-wrap gap-1 items-center">
                              {formData.vendor_category.length > 0 ? (
                                formData.vendor_category.map((cat) => (
                                  <Badge key={cat} variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-200 border-none px-2 rounded-md h-6 flex items-center gap-1">
                                    {cat}
                                    <X 
                                      className="h-3 w-3 cursor-pointer" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setFormData(prev => ({
                                          ...prev,
                                          vendor_category: prev.vendor_category.filter(c => c !== cat)
                                        }));
                                      }}
                                    />
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-slate-400 font-normal">Select areas of expertise...</span>
                              )}
                            </div>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[400px] p-0 shadow-2xl rounded-xl border-slate-200" align="start">
                          <Command className="rounded-xl">
                            <CommandInput placeholder="Search categories..." className="h-11" />
                            <CommandList className="max-h-[300px]">
                              <CommandEmpty>No category found.</CommandEmpty>
                              <CommandGroup>
                                {dbCategories.map((category) => (
                                  <CommandItem
                                    key={category.id}
                                    onSelect={() => {
                                      const isSelected = formData.vendor_category.includes(category.name);
                                      setFormData(prev => ({
                                        ...prev,
                                        vendor_category: isSelected 
                                          ? prev.vendor_category.filter(c => c !== category.name)
                                          : [...prev.vendor_category, category.name]
                                      }));
                                    }}
                                    className="flex items-center justify-between py-3 px-4 cursor-pointer hover:bg-slate-50"
                                  >
                                    <span className="text-sm font-medium">{category.name}</span>
                                    {formData.vendor_category.includes(category.name) && (
                                      <Check className="h-4 w-4 text-slate-900" />
                                    )}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

                  {/* Location Details */}
                  <div className="space-y-6">
                    <p className="text-sm font-bold uppercase tracking-wider text-slate-400 border-b pb-2">Geographic Presence</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                      <div className="space-y-2.5">
                        <Label className="text-xs font-bold text-slate-700">Detailed Address <Required /></Label>
                        <Input
                          placeholder="No. 42, Main Street, Industrial Zone"
                          value={formData.location}
                          onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                          className="h-11 border-slate-200 rounded-lg"
                        />
                      </div>
                      <div className="space-y-2.5">
                        <Label className="text-xs font-bold text-slate-700">Landmark / Sub-locality</Label>
                        <Input
                          placeholder="Near Central Metro Station"
                          value={formData.new_location}
                          onChange={(e) => setFormData({ ...formData, new_location: e.target.value })}
                          className="h-11 border-slate-200 rounded-lg"
                        />
                      </div>
                      <div className="space-y-2.5">
                        <Label className="text-xs font-bold text-slate-700">City <Required /></Label>
                        <Input
                          placeholder="e.g. Chennai"
                          value={formData.city}
                          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                          className="h-11 border-slate-200 rounded-lg"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2.5">
                          <Label className="text-xs font-bold text-slate-700">State <Required /></Label>
                          <Select
                            value={formData.state}
                            onValueChange={(val) => setFormData({ ...formData, state: val })}
                          >
                            <SelectTrigger className="h-11 border-slate-200 rounded-lg">
                              <SelectValue placeholder="State" />
                            </SelectTrigger>
                            <SelectContent>
                              {INDIAN_STATES.map((s) => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2.5">
                          <Label className="text-xs font-bold text-slate-700">Pincode <Required /></Label>
                          <Input
                            placeholder="600001"
                            value={formData.pincode}
                            onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                            className="h-11 border-slate-200 rounded-lg"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Legal Information */}
                  <div className="space-y-6">
                    <p className="text-sm font-bold uppercase tracking-wider text-slate-400 border-b pb-2">Compliance & Policy</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                      <div className="space-y-2.5">
                        <Label className="text-xs font-bold text-slate-700">GST Registration Number</Label>
                        <Input
                          placeholder="33AAAAA0000A1Z5"
                          value={formData.gstNo}
                          onChange={(e) => setFormData({ ...formData, gstNo: e.target.value })}
                          className="h-11 border-slate-200 rounded-lg px-4"
                        />
                      </div>
                      <div className="space-y-2.5">
                        <Label className="text-xs font-bold text-slate-700">Operations Terms & Conditions</Label>
                        <Input
                          placeholder="Standard billing and return policies"
                          value={formData.terms_and_conditions}
                          onChange={(e) => setFormData({ ...formData, terms_and_conditions: e.target.value })}
                          className="h-11 border-slate-200 rounded-lg px-4"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-6 border-t flex flex-col sm:flex-row gap-3">
                    <Button
                      type="submit"
                      disabled={submitting}
                      className="bg-slate-900 hover:bg-slate-800 text-white font-bold h-11 px-8 rounded-lg shadow-sm flex-1 transition-all active:scale-95 text-sm"
                    >
                      {submitting ? "Processing..." : (editingShopId ? "Save Changes" : "Register Shop")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetForm}
                      disabled={submitting}
                      className="border-slate-300 text-slate-600 font-semibold h-11 px-8 rounded-lg text-sm"
                    >
                      Discard
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Shops List */}
          <div className="space-y-5">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              Registered Establishments 
              {!loadingShops && <Badge variant="secondary" className="bg-slate-100 text-slate-600 ml-1 text-[10px] px-1.5 py-0 h-4 rounded-sm">{shops.length}</Badge>}
            </h2>
            
            {loadingShops ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => (
                  <Card key={i} className="h-64 animate-pulse bg-slate-50 border-slate-200 rounded-xl" />
                ))}
              </div>
            ) : shops.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {shops.map((shop) => (
                  <Card key={shop.id} className="group border-slate-200 hover:border-blue-200 hover:shadow-md transition-all duration-300 rounded-xl overflow-hidden bg-white">
                    <div className="relative h-1.5 bg-slate-100 group-hover:bg-blue-600 transition-colors" />
                    <CardHeader className="pb-3 pt-4 px-5">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <CardTitle className="text-base font-bold text-slate-900 transition-colors">{shop.name}</CardTitle>
                          <Badge 
                            variant={shop.approved ? "default" : "secondary"}
                            className={cn(
                              "text-[9px] uppercase font-bold px-1.5 py-0 border-none rounded-sm",
                              shop.approved ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                            )}
                          >
                            {shop.approved ? "Active" : "Pending"}
                          </Badge>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 w-7 p-0 text-slate-400 hover:text-slate-900 rounded-md"
                          onClick={() => startEdit(shop)}
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5 px-5 pb-5">
                      <div className="space-y-2.5">
                        <div className="flex items-start gap-2">
                          <MapPin className="h-3 w-3 text-slate-400 mt-0.5 shrink-0" />
                          <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                            {shop.location}, {shop.city}, {shop.state} - {shop.pincode}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                          <p className="text-[11px] text-slate-600 font-bold tracking-tight">
                            {shop.phoneCountryCode} {shop.contactNumber}
                          </p>
                        </div>
                        {shop.vendor_category && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {shop.vendor_category.split(",").slice(0, 3).map((cat: string) => (
                              <Badge key={cat} variant="outline" className="text-[8px] bg-slate-50 border-slate-100 text-slate-500 font-bold px-1 py-0 h-3.5 rounded-sm">
                                {cat.trim()}
                              </Badge>
                            ))}
                            {shop.vendor_category.split(",").length > 3 && (
                              <span className="text-[8px] text-slate-400 font-bold">+{shop.vendor_category.split(",").length - 3}</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="pt-3 border-t border-slate-50 flex items-center justify-between">
                         <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-bold uppercase text-slate-400 tracking-tighter">GST:</span>
                            <span className="text-[9px] font-bold text-slate-600">{shop.gstNo || shop.gstno || "N/A"}</span>
                         </div>
                         <Button 
                          variant="link" 
                          size="sm" 
                          className="text-blue-600 font-bold text-[10px] p-0 h-auto hover:no-underline"
                          onClick={() => startEdit(shop)}
                         >
                           EDIT DETAILS →
                         </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                <Store className="h-12 w-12 text-slate-200 mx-auto mb-4" />
                <p className="text-slate-500 font-medium">No shops found in our records.</p>
                <Button variant="link" onClick={() => setShowForm(true)} className="text-slate-900 font-bold mt-2">
                  Launch Your First Outlet
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </LayoutComponent>
  );
}
