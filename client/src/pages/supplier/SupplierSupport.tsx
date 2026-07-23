import { useState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/lib/store";
import { getJSON } from "@/lib/api";
import {
  MessageSquare,
  Send,
  Trash2,
  Loader2,
  AlertCircle,
  MoreVertical,
  Check,
  CheckCheck,
  Paperclip,
  Smile,
  User,
  ShieldCheck,
} from "lucide-react";
import { SupplierLayout } from "@/components/layout/SupplierLayout";
import { DeleteConfirmationDialog } from "@/components/ui/DeleteConfirmationDialog";

interface Message {
  id: string;
  sender_name?: string;
  message: string;
  additional_info?: string;
  admin_reply?: string;
  submitted_at: string;
  is_read?: boolean;
}

export function SupplierSupport({
  shopName = "Shop",
  shopLocation = "",
}: {
  shopName?: string;
  shopLocation?: string;
}) {
  const { toast } = useToast();
  const { addSupportMessage, deleteMessage, user } = useData();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState(user?.fullName || user?.username || "");
  const [email, setEmail] = useState(user?.username || "");
  const [message, setMessage] = useState("");
  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; id: string; name: string } | null>(null);
  const [fetchedShopName, setFetchedShopName] = useState(shopName);
  const [fetchedShopLocation, setFetchedShopLocation] = useState(shopLocation);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMessages();
  }, []);

  // The /supplier/support route renders this page with no props, so shopName/shopLocation
  // above always fall back to their defaults. Fetch the real shop here, same source used
  // by the other supplier pages, so the sidebar shows the actual shop name.
  useEffect(() => {
    (async () => {
      try {
        const data = await getJSON("/api/supplier/my-shops");
        const shops = data?.shops || [];
        const primaryShop = shops.find((s: any) => s.approved === true) || shops[0];
        if (primaryShop) {
          setFetchedShopName(primaryShop.name);
          setFetchedShopLocation(primaryShop.location || "");
        }
      } catch (e) {
        console.error("shop load error", e);
      }
    })();
  }, []);


  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadMessages = async () => {
    try {
      setLoading(true);
      const data = await getJSON('/support-messages');
      // Filter messages for this supplier if email is known
      const filtered = (data.messages || []).filter((m: any) =>
        !email || m.sender_email === email || m.sender_name === name
      );
      setMessages(filtered);
    } catch (error) {
      console.error("Error loading messages:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!message.trim()) return;

    setSubmitting(true);
    try {
      const response = await addSupportMessage?.(name || "Vendor", message);

      // Update local state immediately if response returned a message
      if (response && typeof response === 'object') {
        setMessages(prev => [...prev, response]);
      } else {
        await loadMessages();
      }

      setMessage("");
      toast({
        title: "Sent",
        description: "Message delivered to support team",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to submit message",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMessage = async (id: string) => {
    setDeleteDialog({
      isOpen: true,
      id: id,
      name: "Support Message"
    });
  };

  const confirmDeleteMessage = async () => {
    if (!deleteDialog) return;
    const { id } = deleteDialog;

    try {
      await deleteMessage?.(id);
      setMessages(messages.filter((m) => m.id !== id));
      toast({
        title: "Deleted",
        description: "Message removed from history",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete message",
        variant: "destructive",
      });
    } finally {
      setDeleteDialog(null);
    }
  };

  return (
    <SupplierLayout shopName={fetchedShopName} shopLocation={fetchedShopLocation} shopApproved={true}>
      <div className="flex flex-col h-[calc(100vh-64px)] lg:h-screen bg-[#F0F2F5] overflow-hidden">

        {/* Support Header */}
        <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between z-10 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-md">
              <ShieldCheck size={20} strokeWidth={2} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-slate-900 tracking-tight">Software Support Team</h2>
                <Badge className="bg-emerald-50 text-emerald-600 border-none font-bold text-[9px] h-4.5 px-1.5 animate-pulse rounded-sm">ACTIVE</Badge>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Protocol Online</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <MoreVertical size={20} className="cursor-pointer hover:text-slate-900 transition-colors" />
          </div>
        </div>

        {/* Chat Area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-6 space-y-6 scroll-smooth"
          style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')", backgroundBlendMode: 'overlay', backgroundColor: '#efe7dd' }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="animate-spin text-blue-600" />
            </div>
          ) : messages.length === 0 ? (
            <div className="bg-white/90 p-4 rounded-xl shadow-sm max-w-sm mx-auto text-center border border-yellow-100">
              <p className="text-sm text-gray-600 font-medium">
                🔒 Messages are end-to-end encrypted. No one outside of this chat, not even BOQ, can read them.
              </p>
              <p className="text-xs text-blue-600 mt-2 font-bold uppercase tracking-wider">Start a conversation below</p>
            </div>
          ) : (
            <div className="flex flex-col space-y-4 max-w-3xl mx-auto w-full">
              {messages.map((msg) => (
                <div key={msg.id} className="space-y-4">
                  {/* Supplier Message (Right) */}
                  <div className="flex justify-end group">
                    <div className="relative max-w-[85%] lg:max-w-[70%] bg-[#dcf8c6] p-2.5 rounded-xl rounded-tr-none shadow-sm border-l-4 border-l-green-200">
                      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                        {msg.message}
                      </p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className="text-[9px] text-gray-500 font-medium whitespace-nowrap">
                          {new Date(msg.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.is_read ? (
                          <CheckCheck size={12} className="text-blue-500" />
                        ) : (
                          <Check size={12} className="text-gray-400" />
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteMessage(msg.id)}
                        className="absolute -left-8 top-1 opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Admin Reply (Left) */}
                  {msg.admin_reply && (
                    <div className="flex justify-start">
                      <div className="relative max-w-[85%] lg:max-w-[70%] bg-white p-2.5 rounded-xl rounded-tl-none shadow-sm border-l-4 border-l-blue-200">
                        <p className="text-[9px] font-bold text-blue-600 uppercase tracking-tight mb-1">Support Team</p>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                          {msg.admin_reply}
                        </p>
                        <div className="flex items-center justify-end mt-1">
                          <span className="text-[9px] text-gray-400 font-medium">
                            {new Date(msg.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="bg-[#f0f2f5] px-4 py-2 border-t border-gray-200">
          <div className="flex items-center gap-2.5 max-w-4xl mx-auto">
            <div className="flex items-center gap-2.5 text-gray-400">
              <Smile size={22} className="cursor-pointer hover:text-gray-600" />
              <Paperclip size={22} className="cursor-pointer hover:text-gray-600" />
            </div>

            <div className="flex-1 relative">
              <Textarea
                placeholder="Type a message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                className="min-h-[40px] max-h-32 py-2.5 px-4 rounded-lg border-none focus:ring-0 resize-none shadow-sm text-sm leading-tight bg-white"
              />
            </div>

            <Button
              onClick={() => handleSubmit()}
              disabled={submitting || !message.trim()}
              className={`
                h-10 w-10 rounded-full p-0 flex items-center justify-center transition-all
                ${message.trim() ? "bg-blue-600 hover:bg-blue-700 shadow-md scale-100" : "bg-gray-400 opacity-50 scale-90"}
              `}
            >
              {submitting ? (
                <Loader2 size={18} className="animate-spin text-white" />
              ) : (
                <Send size={18} className="text-white ml-0.5" />
              )}
            </Button>
          </div>
          <p className="text-[9px] text-center text-gray-400 mt-1.5 font-medium">
            Shift + Enter for new line
          </p>
        </div>

        {deleteDialog && (
          <DeleteConfirmationDialog
            isOpen={deleteDialog.isOpen}
            onOpenChange={(open) => !open && setDeleteDialog(null)}
            onConfirm={confirmDeleteMessage}
            itemName={deleteDialog.name}
            title="Delete Message?"
          />
        )}
      </div>
    </SupplierLayout>
  );
}