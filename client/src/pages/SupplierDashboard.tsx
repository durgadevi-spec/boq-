import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useData } from "@/lib/store";
import { Layout } from "@/components/layout/Layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Clock, Building2, Loader2 } from "lucide-react";
import { AddShopForm } from "@/components/supplier/AddShopForm";
import { SupplierDashboardPage } from "@/pages/supplier/SupplierDashboardPage";
import { SupplierLayout } from "@/components/layout/SupplierLayout";

interface Shop {
  id: string;
  name: string;
  location?: string;
  approved?: boolean;
  city?: string;
  created_at?: string;
}

type SupplierStatus =
  | "not-approved"
  | "no-shop"
  | "shop-pending"
  | "shop-approved"
  | "error"
  | "loading";

export default function SupplierDashboard() {
  const [, setLocation] = useLocation();
  const { user } = useData();
  const [status, setStatus] = useState<SupplierStatus>("loading");
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || user.role !== "supplier") {
      setLocation("/");
      return;
    }

    // Check supplier approval and shop status
    checkSupplierStatus();
  }, [user, setLocation]);

  const checkSupplierStatus = async () => {
    try {
      setLoading(true);

      // Check if supplier is approved
      if (user?.approved !== "approved") {
        setStatus("not-approved");
        setLoading(false);
        return;
      }

      // Load supplier's shops
      const token = localStorage.getItem("authToken");
      const response = await fetch("/api/supplier/my-shops", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        console.error("Failed to load shops");
        setStatus("error");
        setLoading(false);
        return;
      }

      const data = await response.json();
      const supplierShops = data.shops || [];
      setShops(supplierShops);

      // Determine status based on shops
      if (supplierShops.length === 0) {
        setStatus("no-shop");
      } else {
        // Check if any shop is approved
        const approvedShop = supplierShops.find((s: Shop) => s.approved === true);
        if (approvedShop) {
          setStatus("shop-approved");
        } else {
          setStatus("shop-pending");
        }
      }
    } catch (error) {
      console.error("Error checking supplier status:", error);
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  const handleShopAdded = () => {
    setStatus("shop-pending");
    checkSupplierStatus();
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50/50">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-sm font-medium text-slate-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // STATUS: Could not verify shop status - never assume "no shop" here, since that could
  // incorrectly re-show the Add Shop registration form to a supplier who already has one,
  // risking a duplicate shop record.
  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-4">
        <Card className="w-full max-w-md border-slate-200 bg-white shadow-sm rounded-xl overflow-hidden">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6 text-rose-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-1">Couldn't load your shop status</h2>
              <p className="text-sm font-medium text-slate-500">
                We weren't able to confirm your shop details. Please try again — we don't want to risk creating a duplicate shop.
              </p>
            </div>
            <Button
              onClick={() => checkSupplierStatus()}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold h-11 rounded-lg"
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // STATUS: Supplier account not approved
  if (status === "not-approved") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-4">
        <Card className="w-full max-w-md border-slate-200 bg-white shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="text-center pb-2 pt-8">
            <div className="flex justify-center mb-4">
              <div className="p-3 bg-blue-50 rounded-lg">
                <AlertCircle className="w-6 h-6 text-blue-600" />
              </div>
            </div>
            <CardTitle className="text-xl font-bold text-slate-900">Account Pending Review</CardTitle>
            <CardDescription className="text-xs font-medium text-slate-500">
              Your supplier account is awaiting approval
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-6">
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <p className="text-sm text-slate-600 font-medium leading-relaxed">
                Thank you for registering! Your account is currently under review.
                You'll receive a notification once your account is active.
              </p>
            </div>

            {user?.approvalReason && (
              <div className="p-4 bg-rose-50 rounded-lg border border-rose-100">
                <p className="text-[10px] font-bold uppercase tracking-wider text-rose-800/60 mb-1">
                  Reviewer Feedback
                </p>
                <p className="text-sm text-rose-700 font-medium">{user.approvalReason}</p>
              </div>
            )}

            <div className="text-sm text-slate-600 space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Verification Protocol:</p>
              <ul className="space-y-1.5 text-xs font-medium text-slate-500">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Business Credentials</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> GST Registration</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Physical Address</li>
              </ul>
            </div>

            <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 text-[11px] font-bold text-blue-700 text-center uppercase tracking-wider">
              Typical window: 24-48 hours
            </div>

            <Button
              onClick={() => setLocation("/")}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold h-11 rounded-lg"
            >
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // STATUS: Supplier approved but no shop yet
  if (status === "no-shop") {
    return <AddShopForm onShopAdded={handleShopAdded} />;
  }

  // STATUS: Shop pending approval
  if (status === "shop-pending") {
    const pendingShop = shops.find((s) => !s.approved);

    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-4">
        <Card className="w-full max-w-md border-slate-200 bg-white shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="text-center pb-2 pt-8">
            <div className="flex justify-center mb-4">
              <div className="p-3 bg-blue-50 rounded-lg">
                <Clock className="w-6 h-6 text-blue-600" />
              </div>
            </div>
            <CardTitle className="text-xl font-bold text-slate-900">
              Shop Under Review
            </CardTitle>
            <CardDescription className="text-xs font-medium text-slate-500">
              Your shop is awaiting approval
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-6">
            {pendingShop && (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-start gap-3">
                  <Building2 className="w-4 h-4 text-slate-400 mt-1" />
                  <div>
                    <p className="font-bold text-slate-900 text-sm">
                      {pendingShop.name}
                    </p>
                    {pendingShop.city && (
                      <p className="text-[11px] text-slate-500 font-medium">
                        {pendingShop.city}
                        {pendingShop.location && ` • ${pendingShop.location}`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-sm text-blue-900/80 font-medium leading-relaxed">
                We're reviewing your shop details. Our team typically
                completes this within 24-48 hours.
              </p>
            </div>

            <Button
              onClick={() => setLocation("/")}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold h-11 rounded-lg"
            >
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>

    );
  }

  // STATUS: Shop approved - Show full dashboard
  if (status === "shop-approved") {
    const approvedShop = shops.find((s) => s.approved === true);

    return (
      <SupplierDashboardPage
        shopName={approvedShop?.name || "Shop"}
        shopLocation={approvedShop?.location || ""}
      />
    );
  }

  return null;
}