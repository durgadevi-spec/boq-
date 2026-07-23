import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Package, TrendingUp, MessagesSquare, ArrowUpRight, Clock, Ban, ChevronRight } from "lucide-react";
import { SupplierLayout } from "@/components/layout/SupplierLayout";
import { cn } from "@/lib/utils";

interface ActivityStats {
  submitted: number;
  approved: number;
  rejected: number;
  pending: number;
}

interface SupplierDashboardPageProps {
  shopName?: string;
  shopLocation?: string;
}

export function SupplierDashboardPage({
  shopName = "Shop",
  shopLocation = "",
}: SupplierDashboardPageProps) {
  const [stats, setStats] = useState<ActivityStats>({
    submitted: 0,
    approved: 0,
    rejected: 0,
    pending: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadActivityStats();
  }, []);

  const loadActivityStats = async () => {
    try {
      const token = localStorage.getItem("authToken");

      const response = await fetch("/api/supplier/my-submissions", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        setLoading(false);
        return;
      }

      const data = await response.json();
      const submissions = data.submissions || [];

      const submitted = submissions.length;
      const approved = submissions.filter((s: any) => s.status === "approved").length;
      const rejected = submissions.filter((s: any) => s.status === "rejected").length;
      const pending = submissions.filter((s: any) => s.status === "pending").length;

      setStats({ submitted, approved, rejected, pending });
    } catch (error) {
      console.error("Error loading stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({
    title,
    value,
    icon: Icon,
    colorClass,
    subtitle,
  }: {
    title: string;
    value: number;
    icon: any;
    colorClass: string;
    subtitle: string;
  }) => {
    const colorMap: Record<string, string> = {
      "bg-blue-500": "text-blue-600 bg-blue-50",
      "bg-emerald-500": "text-emerald-600 bg-emerald-50",
      "bg-amber-500": "text-amber-600 bg-amber-50",
      "bg-rose-500": "text-rose-600 bg-rose-50",
    };

    const colors = colorMap[colorClass] || "text-slate-600 bg-slate-50";

    return (
      <Card className="shadow-[0_2px_10px_rgba(0,0,0,0.04)] border-slate-200/60 bg-white group hover:border-blue-200 transition-all duration-300 rounded-2xl">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{title}</p>
              <p className="text-3xl font-black text-slate-900 tracking-tight">{value}</p>
              <p className="text-[11px] font-semibold text-slate-500/80">{subtitle}</p>
            </div>
            <div className={cn("p-3 rounded-xl transition-all duration-300 group-hover:scale-110", colors)}>
              <Icon size={22} strokeWidth={2.5} />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <SupplierLayout shopName={shopName} shopLocation={shopLocation} shopApproved={true}>
      <div className="min-h-screen bg-[#FDFDFD]">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">

          {/* Hero Section */}
          <div className="bg-white p-8 rounded-3xl shadow-[0_2px_15px_rgba(0,0,0,0.03)] border border-slate-100">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold uppercase tracking-wider">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                  Live Monitoring
                </div>
                <h1 className="text-3xl font-black tracking-tight text-slate-900" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                  Vendor Dashboard
                </h1>
                <p className="text-slate-500 max-w-md text-sm font-medium leading-relaxed">
                  Monitor your operations, manage material catalogue, and track submissions in real-time.
                </p>
              </div>

              <div className="flex items-center gap-6 md:border-l md:border-slate-100 md:pl-8">
                <div className="text-left md:text-right">
                  <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-1">Active Outlet</p>
                  <p className="text-lg font-bold text-slate-900 leading-tight">{shopName}</p>
                  <p className="text-sm font-semibold text-blue-600 mt-0.5">{shopLocation}</p>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-slate-900 flex items-center justify-center text-white shadow-lg shadow-slate-200">
                  <Package size={24} />
                </div>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              title="Catalog Size"
              value={stats.submitted}
              icon={Package}
              colorClass="bg-blue-500"
              subtitle="Total items submitted"
            />
            <StatCard
              title="Verified"
              value={stats.approved}
              icon={CheckCircle2}
              colorClass="bg-emerald-500"
              subtitle="Published to shop"
            />
            <StatCard
              title="Awaiting"
              value={stats.pending}
              icon={Clock}
              colorClass="bg-amber-500"
              subtitle="Pending admin review"
            />
            <StatCard
              title="Adjustments"
              value={stats.rejected}
              icon={Ban}
              colorClass="bg-rose-500"
              subtitle="Requires revision"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Quick Summary Section */}
            <Card className="lg:col-span-2 shadow-[0_2px_15px_rgba(0,0,0,0.03)] border-slate-100 bg-white rounded-3xl overflow-hidden">
              <CardHeader className="border-b border-slate-50 p-6 bg-[#FCFDFF]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-50 rounded-xl text-blue-600">
                      <TrendingUp size={20} strokeWidth={2.5} />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-bold text-slate-900">Operational Summary</CardTitle>
                      <p className="text-xs font-semibold text-slate-400 mt-0.5">Real-time performance analytics</p>
                    </div>
                  </div>
                  <div className="p-2 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer text-slate-400">
                    <ArrowUpRight size={20} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-8">
                <div className="space-y-6">
                  <div className="group flex items-center justify-between p-6 bg-[#F8FAFF] rounded-2xl border border-blue-50 hover:border-blue-100 transition-all">
                    <div className="flex items-center gap-5">
                      <div className="h-14 w-14 rounded-2xl bg-white border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm shadow-blue-100 group-hover:scale-105 transition-transform">
                        <ArrowUpRight size={28} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 text-base mb-0.5">Review Velocity</p>
                        <p className="text-xs text-slate-500 font-semibold tracking-tight italic">Approval to Submission ratio</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-black text-slate-900 tracking-tighter">
                        {stats.submitted > 0 ? `${Math.round((stats.approved / stats.submitted) * 100)}%` : "0%"}
                      </p>
                      <Badge className="bg-slate-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-md mt-1">METRICS</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                    <div className="p-5 bg-emerald-50/40 rounded-2xl border border-emerald-100/50 flex items-center gap-4 group hover:bg-emerald-50/60 transition-colors">
                      <div className="p-3 bg-white rounded-xl text-emerald-600 border border-emerald-100 shadow-sm shadow-emerald-50">
                        <CheckCircle2 size={18} strokeWidth={2.5} />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-800/50">Live Items</p>
                        <p className="text-xl font-black text-emerald-900">{stats.approved}</p>
                      </div>
                    </div>
                    <div className="p-5 bg-amber-50/40 rounded-2xl border border-amber-100/50 flex items-center gap-4 group hover:bg-amber-50/60 transition-colors">
                      <div className="p-3 bg-white rounded-xl text-amber-600 border border-amber-100 shadow-sm shadow-amber-50">
                        <Clock size={18} strokeWidth={2.5} />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-800/50">In Pipeline</p>
                        <p className="text-xl font-black text-amber-900">{stats.pending}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Support/Help Section */}
            <Card className="shadow-[0_2px_15px_rgba(0,0,0,0.03)] border-slate-100 bg-white rounded-3xl overflow-hidden">
              <CardHeader className="p-8 pb-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 mb-6 shadow-sm shadow-blue-50">
                  <MessagesSquare size={24} strokeWidth={2.5} />
                </div>
                <CardTitle className="text-xl font-bold text-slate-900">Need Assistance?</CardTitle>
                <p className="text-sm text-slate-500 font-semibold mt-1">Our support protocols are live</p>
              </CardHeader>
              <CardContent className="space-y-6 px-8 pb-8 pt-4">
                <p className="text-sm text-slate-500 font-medium leading-relaxed">
                  Connect with our procurement experts for catalogue optimization or commercial inquiries.
                </p>

                <div className="space-y-3">
                  {[
                    { label: "Material Catalogue Guidance", icon: Package },
                    { label: "Technical Account Support", icon: MessagesSquare },
                    { label: "Commercial Terms Help", icon: TrendingUp }
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between px-4 py-4 bg-[#F8FAFF] border border-blue-50 rounded-2xl hover:border-blue-200 transition-all cursor-pointer group">
                      <div className="flex items-center gap-3">
                        <item.icon size={18} className="text-blue-400 group-hover:text-blue-600 transition-colors" />
                        <span className="text-xs font-bold text-slate-700 tracking-tight">{item.label}</span>
                      </div>
                      <ChevronRight size={14} className="text-blue-200 group-hover:text-blue-400 transition-all group-hover:translate-x-1" />
                    </div>
                  ))}
                </div>

                <div className="pt-6 border-t border-slate-50">
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Response SLA</p>
                    <p className="text-[11px] text-blue-600/70 font-bold italic">Standard Window: 2-4 hours</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </SupplierLayout>
  );
}
