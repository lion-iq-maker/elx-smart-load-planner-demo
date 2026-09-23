import {
  AlertTriangle, ArrowLeft, ArrowRight, BarChart3, Boxes, Camera, CheckCircle2, ClipboardCheck, ClipboardList,
  Download, Edit3, FileText, Home, Link2, Mail, MapPin, Menu, MessageCircle, PackagePlus, PenLine, Plus,
  RotateCw, Search, Settings, ShieldCheck, Signature, Sparkles, Trash2, Truck, Upload, Users, Warehouse, X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import {
  createDriverSchedule, deleteDriverSchedule as deleteDriverScheduleFromApi,
  fetchDriverScheduleLookups, fetchDriverSchedules, getDriverScheduleLoginUrl, updateDriverSchedule,
  type DriverScheduleApiItem, type DriverScheduleLookups, type DriverSchedulePayload, type DriverScheduleStatus
} from "./utils/driverScheduleApi";
import { getFreightQueue, createFreightQueueItem, updateFreightQueueItem, deleteFreightQueueItem, mapFromApi, createLoadPlan, updateLoadPlan as updateLoadPlanApi, getLoadPlan, convertRowVersionFromApi, getFreightAllocations, saveFreightAllocations, saveFreightAllocationDraft, listResumableLoadPlans, listGeneratedReports, saveGeneratedReport as saveGeneratedReportApi, getLoadPlanSignatures, saveLoadPlanSignature, completeLoadPlan, confirmReview, apiBase } from "./utils/loadPlansApi";

// ============================================================
// TYPES
// ============================================================
type StepKey = "freightqueue" | "create" | "freight" | "review" | "sign" | "report";
type SidebarPage = "Dashboard" | "Load Plans" | "Truck Management" | "Trailers" | "Freight" | "Customers" | "Reports" | "Driver Schedule" | "Settings" | "LoadIQ Assistant";
type FreightStatus = "loading" | "loaded" | "warning" | "exception";
type FreightKind = "Pallets" | "Machinery" | "Crates" | "Pipe Bundles" | "General Freight";
type LoadPlanStatus = "Draft" | "In Progress" | "Completed";
type FleetStatus = "Available" | "In Use" | "Maintenance" | "Unavailable" | "Retired";
type AttachmentType = "image" | "pdf" | "spreadsheet" | "csv";

interface WorkflowStep { key: StepKey; title: string; short: string; icon: LucideIcon; }
interface TrailerSpec { lengthM: number; widthM: number; heightM: number; payloadKg: number; }
interface TrailerRecord extends TrailerSpec { id: string; number: string; type: string; status: FleetStatus; documents: FreightAttachment[]; }
interface TruckRecord { id: string; number: string; make: string; model: string; registration: string; driver: string; location: string; status: FleetStatus; assignedTrailerNumbers: string[]; notes: string; }
interface CustomerRecord { id: string; name: string; contactPerson: string; email: string; phone: string; address: string; defaultOrigin: string; defaultDestination: string; notes: string; }
interface LoadPlanForm { loadNumber: string; status: LoadPlanStatus; customer: string; driver: string; forkliftOperator: string; truckType: string; trailerType: string; trailerNumber: string; trailerNumbers: string[]; origin: string; destination: string; departureDate: string; departureTime: string; }
interface FreightAttachment { id: string; name: string; type: AttachmentType; url?: string; previewText?: string; }
interface FreightItem {
  id: string;

  conNote: string;
  consignmentLine: string;
  consignment: string;
  product: string;

  customerName: string;

  freightType: FreightKind;
  description: string;
  type: string;

  number: number;
  quantity?: number;

  lengthCm: number;
  widthCm: number;
  heightCm: number;

  lengthM: number;
  widthM: number;
  heightM: number;

  weightKg: number;

  palletCount: number;
  customerRef: string;

  isDg: boolean;
  dgClass: string;
  dgUnId: string;
  dgWeightKg: number | null;

  dg: string;

  status: FreightStatus;

  xM: number;
  yM: number;
  rotated: boolean;

  attachments: FreightAttachment[];

  allocated: boolean;
  allocatedToTrailer: string | null;

  _rowVersion?: number;
  _apiBacked?: boolean;
  _allocationId?: string;
}
interface ConNote { id: string; number: string; freightId: string; customerRef: string; description: string; palletCount: number; weightKg: number; notes: string; attachments: FreightAttachment[]; }
interface SignatureState { dataUrl: string; timestamp: string; signedBy: string; }
interface GeneratedReport { id: string; loadPlanId: string; loadNumber: string; customer: string; trailerNumber: string; status: "Pending Customer Copy" | "Customer Copy Sent" | "Generated" | "Requires Review"; generatedAt: string; verificationId: string; downloaded: boolean; sent: boolean; }
interface AiPlanningReadiness { trailerRecommendation: string; truckRecommendation: string; loadSequencing: string; weightDistribution: string; complianceChecks: string; spaceOptimisation: string; attachments: FreightAttachment[]; }
interface SettingsState { companyName: string; abn: string; supportEmail: string; operationsEmail: string; primaryColour: string; secondaryColour: string; defaultTruckType: string; defaultTrailerType: string; payloadWarningPercent: number; sendCustomerCopy: boolean; notifyAdminException: boolean; notifyDriverBeforeDeparture: boolean; }
interface LoadSummary { freightCount: number; palletCount: number; totalWeightKg: number; floorPercent: number; remainingPercent: number; warningCount: number; exceptionCount: number; }

// ============================================================
// CONSTANTS & INITIAL DATA
// ============================================================
const workflowSteps: WorkflowStep[] = [
  { key: "freightqueue", title: "Freight Queue", short: "Queue", icon: Boxes },
  { key: "create", title: "Create Load Plan", short: "Create", icon: ClipboardList },
  { key: "freight", title: "Freight / Trailer Layout", short: "Freight", icon: Truck },
  { key: "review", title: "Review & Confirm", short: "Review", icon: ClipboardCheck },
  { key: "sign", title: "Sign & Complete", short: "Sign", icon: Signature },
  { key: "report", title: "Generate Report", short: "Report", icon: FileText }
];

const sidebarItems: Array<{ label: SidebarPage; icon: LucideIcon }> = [
  { label: "Dashboard", icon: Home }, { label: "Load Plans", icon: ClipboardList }, { label: "Truck Management", icon: Truck },
  { label: "Trailers", icon: Truck }, { label: "Freight", icon: Boxes }, { label: "Customers", icon: Users },
  { label: "Reports", icon: BarChart3 }, { label: "Driver Schedule", icon: MapPin }, { label: "Settings", icon: Settings }
];

const truckTypes = ["Semi Trailer", "B Double", "Road Train", "Rigid", "Drop Deck"];
const trailerTypes = ["Curtainsider", "Flat Top", "Refrigerated", "Mezzanine", "Tautliner", "Drop Deck"];
const drivers = ["John Smith", "Mark Wilson", "Available Driver 1", "Available Driver 2"];
const freightTypes: FreightKind[] = ["Pallets", "Machinery", "Crates", "Pipe Bundles", "General Freight"];

const statusStyles: Record<FreightStatus, { label: string; block: string; badge: string; dot: string }> = {
  loading: { label: "Loading", block: "border-blue-500 bg-blue-600 text-white", badge: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-500" },
  loaded: { label: "Loaded", block: "border-emerald-500 bg-emerald-600 text-white", badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  warning: { label: "Warning", block: "border-amber-500 bg-amber-400 text-slate-950", badge: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-400" },
  exception: { label: "Exception", block: "border-red-600 bg-red-600 text-white", badge: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-600" }
};

const freightTypeStyles: Record<FreightKind, { label: string; className: string; stripe: string }> = {
  Pallets: { label: "Pallet", className: "rounded-md", stripe: "bg-white/20" },
  Machinery: { label: "Machine", className: "rounded-xl", stripe: "bg-slate-950/20" },
  Crates: { label: "Crate", className: "rounded-sm", stripe: "bg-amber-100/30" },
  "Pipe Bundles": { label: "Pipe", className: "rounded-full", stripe: "bg-white/25" },
  "General Freight": { label: "General", className: "rounded-md", stripe: "bg-blue-100/25" }
};

const initialTrailers: TrailerRecord[] = [
  { id: "trl-5678", number: "TR-5678", type: "Curtainsider", lengthM: 13.6, widthM: 2.4, heightM: 2.7, payloadKg: 24000, status: "In Use", documents: [] },
  { id: "trl-9021", number: "TR-9021", type: "Flat Top", lengthM: 12.5, widthM: 2.4, heightM: 2.5, payloadKg: 22000, status: "Available", documents: [] },
  { id: "trl-1134", number: "TR-1134", type: "Refrigerated", lengthM: 13.6, widthM: 2.4, heightM: 2.6, payloadKg: 20000, status: "In Use", documents: [] },
  { id: "trl-4402", number: "TR-4402", type: "Drop Deck", lengthM: 14.2, widthM: 2.4, heightM: 3.0, payloadKg: 25000, status: "Maintenance", documents: [] },
  { id: "trl-7788", number: "TR-7788", type: "Tautliner", lengthM: 13.6, widthM: 2.4, heightM: 2.7, payloadKg: 23500, status: "Available", documents: [] },
  { id: "trl-9901", number: "TR-9901", type: "Mezzanine", lengthM: 13.6, widthM: 2.4, heightM: 3.0, payloadKg: 21000, status: "Unavailable", documents: [] }
];

const initialTrucks: TruckRecord[] = [
  { id: "trk-101", number: "TK-101", make: "Kenworth", model: "T610", registration: "ELX-101", driver: "Available Driver 1", location: "Adelaide DC", status: "Available", assignedTrailerNumbers: [], notes: "Ready for allocation." },
  { id: "trk-204", number: "TK-204", make: "Volvo", model: "FH16", registration: "ELX-204", driver: "John Smith", location: "Melbourne Linehaul", status: "In Use", assignedTrailerNumbers: ["TR-5678"], notes: "Assigned to active linehaul." },
  { id: "trk-309", number: "TK-309", make: "Scania", model: "R560", registration: "ELX-309", driver: "Unassigned", location: "Workshop Bay 2", status: "Maintenance", assignedTrailerNumbers: [], notes: "Scheduled service." },
  { id: "trk-411", number: "TK-411", make: "DAF", model: "XF", registration: "ELX-411", driver: "Unassigned", location: "Adelaide DC", status: "Unavailable", assignedTrailerNumbers: [], notes: "Awaiting compliance clearance." },
  { id: "trk-502", number: "TK-502", make: "Mack", model: "Anthem", registration: "ELX-502", driver: "Available Driver 2", location: "Regency Park", status: "Available", assignedTrailerNumbers: ["TR-9021", "TR-7788"], notes: "B-double capable." }
];

const initialCustomers: CustomerRecord[] = [
  { id: "cus-abc", name: "ABC Logistics Ltd.", contactPerson: "Sarah Chen", email: "ops@abclogistics.com", phone: "08 7000 1000", address: "Adelaide SA", defaultOrigin: "Adelaide DC", defaultDestination: "Melbourne Linehaul", notes: "Customer copy required after completion." },
  { id: "cus-santos", name: "Santos", contactPerson: "Michael Tan", email: "freight@santos.com", phone: "08 7000 2000", address: "Port Adelaide SA", defaultOrigin: "Adelaide DC", defaultDestination: "Moomba", notes: "Energy sector freight." },
  { id: "cus-bhp", name: "BHP", contactPerson: "Rebecca Mills", email: "logistics@bhp.com", phone: "08 7000 3000", address: "Adelaide SA", defaultOrigin: "Adelaide DC", defaultDestination: "Olympic Dam", notes: "High priority dispatch windows." },
  { id: "cus-origin", name: "Origin Energy", contactPerson: "David King", email: "transport@origin.com", phone: "08 7000 4000", address: "Adelaide SA", defaultOrigin: "Adelaide DC", defaultDestination: "Roma", notes: "Check delivery windows." },
  { id: "cus-toll", name: "Toll", contactPerson: "Amelia Jones", email: "ops@toll.com", phone: "08 7000 5000", address: "Wingfield SA", defaultOrigin: "Adelaide DC", defaultDestination: "Sydney DC", notes: "Linehaul freight." },
  { id: "cus-linfox", name: "Linfox", contactPerson: "Daniel Kumar", email: "dispatch@linfox.com", phone: "08 7000 6000", address: "Regency Park SA", defaultOrigin: "Adelaide DC", defaultDestination: "Brisbane DC", notes: "Regular customer." }
];

const initialFreight: FreightItem[] = [];
const initialConNotes: ConNote[] = [];

const initialLoadPlan: LoadPlanForm = {
  loadNumber: "", status: "In Progress", customer: "", driver: "", forkliftOperator: "",
  truckType: "", trailerType: "", trailerNumber: "", trailerNumbers: [],
  origin: "", destination: "", departureDate: "", departureTime: ""
};

const initialSettings: SettingsState = {
  companyName: "ELX Logistics", abn: "ABN placeholder", supportEmail: "support@elxlogistics.com", operationsEmail: "operations@elxlogistics.com",
  primaryColour: "#2563eb", secondaryColour: "#07101f", defaultTruckType: "Semi Trailer", defaultTrailerType: "Curtainsider",
  payloadWarningPercent: 90, sendCustomerCopy: true, notifyAdminException: true, notifyDriverBeforeDeparture: false
};

const initialReports: GeneratedReport[] = [];

const initialAiPlanningReadiness: AiPlanningReadiness = {
  trailerRecommendation: "Ready for future recommendation engine.", truckRecommendation: "Ready for future fleet matching.",
  loadSequencing: "Ready for future loading sequence planning.", weightDistribution: "Ready for future axle and payload balance checks.",
  complianceChecks: "Ready for future route and freight compliance checks.", spaceOptimisation: "Ready for future floor-space optimisation.",
  attachments: []
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
const formatKg = (value: number) => {
  const num = Number(value);
  return isNaN(num) ? "0 kg" : `${num.toLocaleString()} kg`;
};
const formatM = (value: number) => {
  const num = Number(value);
  return isNaN(num) ? "0.0 m" : `${num.toFixed(1)} m`;
};
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const classifyAttachment = (file: File): AttachmentType | null => {
  if (["image/jpeg", "image/png"].includes(file.type)) return "image";
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv")) return "csv";
  if (["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(file.type) || /\.(xls|xlsx)$/i.test(file.name)) return "spreadsheet";
  return null;
};

const calculateSummary = (freightItems: FreightItem[], trailerSpec: TrailerSpec): LoadSummary => {
  const totalWeight = freightItems.reduce((s, i) => s + i.weightKg, 0);
  const floorPercent = trailerSpec ? Math.min(100, Math.round((totalWeight / (trailerSpec.payloadKg || 24000)) * 100)) : 0;
  return {
    freightCount: freightItems.length,
    palletCount: freightItems.reduce((s, i) => s + (i.palletCount || 0), 0),
    totalWeightKg: totalWeight,
    floorPercent,
    remainingPercent: Math.max(0, 100 - floorPercent),
    warningCount: 0,
    exceptionCount: 0
  };
};

const emptyFreightDraft = () => ({
  id: `temp-${Date.now()}`,

  conNote: "",
  consignmentLine: "",
  consignment: "",
  product: "",

  customerName: "",

  freightType: "General Freight" as FreightKind,
  description: "",
  type: "GENERAL",

  number: 1,
  quantity: 1,

  lengthCm: 100,
  widthCm: 100,
  heightCm: 100,

  lengthM: 1,
  widthM: 1,
  heightM: 1,

  weightKg: 0,

  palletCount: 0,
  customerRef: "",

  isDg: false,
  dgClass: "",
  dgUnId: "",
  dgWeightKg: null,

  status: "loading" as FreightStatus,

  xM: 0,
  yM: 0,
  rotated: false,

  attachments: [],

  dg: "n/a",

  allocated: false,
  allocatedToTrailer: null
});

const makeTruckDraft = (): TruckRecord => ({
  id: `trk-${Date.now()}`,
  number: "",
  make: "",
  model: "",
  registration: "",
  driver: "",
  location: "",
  status: "Available",
  assignedTrailerNumbers: [],
  notes: ""
});

const makeTrailerDraft = (): TrailerRecord => ({
  id: `trl-${Date.now()}`,
  number: "",
  type: "Curtainsider",
  lengthM: 13.6,
  widthM: 2.4,
  heightM: 2.7,
  payloadKg: 24000,
  status: "Available",
  documents: []
});

const makeCustomerDraft = (): CustomerRecord => ({
  id: `cus-${Date.now()}`,
  name: "",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
  defaultOrigin: "",
  defaultDestination: "",
  notes: ""
});

// ============================================================
// HELPER COMPONENTS
// ============================================================
function TextInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function SelectInput({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <select
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return <TextInput label={label} type="number" value={String(value)} onChange={onChange} />;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function PanelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold text-slate-950">{value}</span>
    </div>
  );
}

function DetailBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function ValidationCard({ type, text }: { type: "ok" | "warning"; text: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      {type === "ok" ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertTriangle size={18} className="shrink-0" />}
      <span>{text}</span>
    </div>
  );
}

function IconAction({ title, icon: Icon, onClick, danger = false }: { title: string; icon: LucideIcon; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid h-9 w-9 place-items-center rounded-md border transition hover:-translate-y-0.5 ${danger ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"}`}
    >
      <Icon size={17} />
    </button>
  );
}

function AttachmentPreview({ attachments, compact = false, onPreview }: { attachments: FreightAttachment[]; compact?: boolean; onPreview?: (attachment: FreightAttachment) => void }) {
  return (
    <div className={compact ? "mt-3 grid grid-cols-3 gap-2" : "mt-4 grid gap-2 sm:grid-cols-3"}>
      {(attachments.length ? attachments : Array.from({ length: compact ? 3 : 1 })).map((attachment, index) => {
        const real = attachment as FreightAttachment | undefined;
        const content = real?.type === "image" && real.url ? (
          <img src={real.url} alt={real.name} className="h-full w-full rounded-md object-cover" />
        ) : real?.type === "pdf" ? (
          <div className="grid place-items-center gap-1 text-xs font-semibold text-red-600">
            <FileText size={20} />
            <span className="max-w-full truncate px-1">{real.name}</span>
          </div>
        ) : real?.type === "csv" || real?.type === "spreadsheet" ? (
          <div className="grid place-items-center gap-1 text-xs font-semibold text-emerald-700">
            <FileText size={20} />
            <span className="max-w-full truncate px-1">{real.name}</span>
          </div>
        ) : (
          <Camera size={16} />
        );
        return real && onPreview ? (
          <button
            key={real.id}
            type="button"
            className="photo-tile min-h-16 text-left transition hover:ring-2 hover:ring-blue-200"
            onClick={() => onPreview(real)}
            title={`Preview ${real.name}`}
          >
            {content}
          </button>
        ) : (
          <div key={real?.id ?? index} className="photo-tile min-h-16">
            {content}
          </div>
        );
      })}
    </div>
  );
}

function AttachmentPreviewModal({ attachment, title, onClose }: { attachment: FreightAttachment; title: string; onClose: () => void }) {
  return (
    <ModalShell title={attachment.name} eyebrow={`${title} attachment`} onClose={onClose}>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-3">
        {attachment.type === "image" && attachment.url ? (
          <img src={attachment.url} alt={attachment.name} className="max-h-[68vh] w-full rounded-md object-contain" />
        ) : attachment.type === "pdf" && attachment.url ? (
          <iframe title={attachment.name} src={attachment.url} className="h-[68vh] w-full rounded-md bg-white" />
        ) : attachment.type === "csv" ? (
          <pre className="max-h-[68vh] overflow-auto rounded-md bg-white p-3 text-xs text-slate-700">
            {attachment.previewText || "CSV preview is being prepared."}
          </pre>
        ) : attachment.type === "spreadsheet" ? (
          <div className="grid h-64 place-items-center rounded-md bg-white p-4 text-center text-sm text-slate-600">
            <div>
              <FileText className="mx-auto mb-2 text-emerald-600" size={28} />
              <div className="font-semibold text-slate-950">{attachment.name}</div>
              <div className="mt-1">Spreadsheet uploaded and ready for future AI processing.</div>
            </div>
          </div>
        ) : (
          <div className="grid h-64 place-items-center text-sm font-semibold text-slate-500">Preview unavailable</div>
        )}
      </div>
    </ModalShell>
  );
}

// ============================================================
// MODAL COMPONENTS
// ============================================================
const ModalShell = ({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) => (
  <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/65 p-3">
    <motion.div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-xl bg-white shadow-2xl" initial={{ opacity: 0, scale: 0.98, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.16 }}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
        <div className="min-w-0"><div className="text-xs font-semibold uppercase text-blue-600">{eyebrow}</div><h2 className="mt-1 truncate text-2xl font-semibold text-slate-950">{title}</h2></div>
        <button className="icon-button" onClick={onClose}><X size={19} /></button>
      </div>
      <div className="p-4">{children}</div>
    </motion.div>
  </div>
);

const FreightFormModal = ({ mode, item, onClose, onSave }: any) => {
  const [formData, setFormData] = useState(() => ({
    ...(item || emptyFreightDraft()),

    customerName:
      item?.customerName ??
      item?.customerRef ??
      "",

    lengthCm:
      item?.lengthCm ??
      Math.round((item?.lengthM ?? 1) * 100),

    widthCm:
      item?.widthCm ??
      Math.round((item?.widthM ?? 1) * 100),

    heightCm:
      item?.heightCm ??
      Math.round((item?.heightM ?? 1) * 100),

    isDg:
      item?.isDg === true,

    dgClass:
      item?.dgClass ?? "",

    dgUnId:
      item?.dgUnId ?? "",

    dgWeightKg:
      item?.dgWeightKg ?? null
  }));

  const handleChange = (field: string, value: any) => {
    setFormData((prev: any) => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = () => {
    if (!formData.customerName?.trim()) {
      alert("Customer is required.");
      return;
    }

    if (!formData.consignment?.trim()) {
      alert("Consignment Number is required.");
      return;
    }

    if (!formData.description?.trim()) {
      alert("Description is required.");
      return;
    }

    if (formData.isDg) {
      if (!formData.dgClass?.trim()) {
        alert("DG Class is required.");
        return;
      }

      if (!formData.dgUnId?.trim()) {
        alert("UN I.D. is required.");
        return;
      }

      if (
        formData.dgWeightKg === null ||
        Number(formData.dgWeightKg) <= 0
      ) {
        alert("DG Weight must be greater than zero.");
        return;
      }
    }

    const lengthCm = Number(formData.lengthCm) || 0;
    const widthCm = Number(formData.widthCm) || 0;
    const heightCm = Number(formData.heightCm) || 0;

    onSave({
      ...formData,

      customerName: formData.customerName.trim(),
      customerRef: formData.customerName.trim(),

      number: Number(formData.number) || 1,
      quantity: Number(formData.number) || 1,

      weightKg: Number(formData.weightKg) || 0,

      lengthCm,
      widthCm,
      heightCm,

      lengthM: lengthCm / 100,
      widthM: widthCm / 100,
      heightM: heightCm / 100,

      isDg: Boolean(formData.isDg),

      dgClass: formData.isDg
        ? formData.dgClass.trim()
        : "",

      dgUnId: formData.isDg
        ? formData.dgUnId.trim()
        : "",

      dgWeightKg: formData.isDg
        ? Number(formData.dgWeightKg)
        : null,

      dg: formData.isDg ? "DG" : "n/a"
    });
  };

  return (
    <ModalShell
      title={mode === "add" ? "Add Freight" : "Edit Freight"}
      eyebrow="Freight"
      onClose={onClose}
    >
      <div className="grid gap-3">

        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Customer"
            value={formData.customerName}
            onChange={(v) => handleChange("customerName", v)}
          />

          <TextInput
            label="Consignment Number"
            value={formData.consignment}
            onChange={(v) => handleChange("consignment", v)}
          />
        </div>

        <TextInput
          label="Description"
          value={formData.description}
          onChange={(v) => handleChange("description", v)}
        />

        <SelectInput
          label="Freight Type"
          value={formData.freightType}
          options={freightTypes}
          onChange={(v) => handleChange("freightType", v)}
        />

        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label="Quantity"
            value={formData.number}
            onChange={(v) =>
              handleChange("number", Number(v))
            }
          />

          <NumberInput
            label="Weight (kg)"
            value={formData.weightKg}
            onChange={(v) =>
              handleChange("weightKg", Number(v))
            }
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <NumberInput
            label="Length (cm)"
            value={formData.lengthCm}
            onChange={(v) =>
              handleChange("lengthCm", Number(v))
            }
          />

          <NumberInput
            label="Width (cm)"
            value={formData.widthCm}
            onChange={(v) =>
              handleChange("widthCm", Number(v))
            }
          />

          <NumberInput
            label="Height (cm)"
            value={formData.heightCm}
            onChange={(v) =>
              handleChange("heightCm", Number(v))
            }
          />
        </div>

        <SelectInput
          label="Dangerous Goods (DG)"
          value={formData.isDg ? "Yes" : "No"}
          options={["No", "Yes"]}
          onChange={(v) =>
            handleChange("isDg", v === "Yes")
          }
        />

        {formData.isDg && (
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-red-200 bg-red-50 p-3">

            <TextInput
              label="DG Class"
              value={formData.dgClass}
              onChange={(v) =>
                handleChange("dgClass", v)
              }
            />

            <TextInput
              label="UN I.D."
              value={formData.dgUnId}
              onChange={(v) =>
                handleChange("dgUnId", v)
              }
            />

            <NumberInput
              label="DG Weight (kg)"
              value={formData.dgWeightKg ?? 0}
              onChange={(v) =>
                handleChange(
                  "dgWeightKg",
                  Number(v)
                )
              }
            />

          </div>
        )}

        <div className="mt-4 flex justify-end gap-2 border-t border-slate-200 pt-3">

          <button
            className="secondary-button"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="primary-button"
            onClick={handleSave}
          >
            Save Freight
          </button>

        </div>

      </div>
    </ModalShell>
  );
};

const TrailerModal = ({ mode, item, onClose, onSave }: any) => (
  <ModalShell title={mode === "add" ? "Add Trailer" : "Edit Trailer"} eyebrow="Trailer" onClose={onClose}>
    <div>Trailer Form (stub)</div>
    <button className="primary-button" onClick={() => onSave(item)}>Save</button>
  </ModalShell>
);

const TruckModal = ({ mode, item, onClose, onSave }: any) => (
  <ModalShell title={mode === "add" ? "Add Truck" : "Edit Truck"} eyebrow="Truck" onClose={onClose}>
    <div>Truck Form (stub)</div>
    <button className="primary-button" onClick={() => onSave(item)}>Save</button>
  </ModalShell>
);

const TrailerDocumentsModal = ({ trailer, onClose, onPreview }: any) => (
  <ModalShell title="Trailer Documents" eyebrow="Documents" onClose={onClose}>
    <div>Documents for {trailer.number}</div>
  </ModalShell>
);

const CustomerModal = ({ mode, item, onClose, onSave }: any) => (
  <ModalShell title={mode === "add" ? "Add Customer" : "Edit Customer"} eyebrow="Customer" onClose={onClose}>
    <div>Customer Form (stub)</div>
    <button className="primary-button" onClick={() => onSave(item)}>Save</button>
  </ModalShell>
);

const ReportPreviewModal = ({ report, freightItems, onGenerate, onClose }: {
  report: GeneratedReport;
  freightItems: FreightItem[];
  onGenerate: (customer: string) => void;
  onClose: () => void;
}) => {
  const [selectedCustomer, setSelectedCustomer] = useState("All Customers");

  const customerOptions = [
    "All Customers",
    ...Array.from(
      new Set(
        freightItems
          .map((item) => item.customerName?.trim())
          .filter((value): value is string => Boolean(value))
      )
    )
  ];

  return (
    <ModalShell title={`Report Preview: ${report.loadNumber}`} eyebrow="Preview" onClose={onClose}>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs font-medium text-slate-500">Load Number</div>
            <div className="text-sm font-semibold text-slate-950">{report.loadNumber}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Trailer</div>
            <div className="text-sm font-semibold text-slate-950">{report.trailerNumber}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Status</div>
            <div className="text-sm font-semibold text-slate-950">{report.status}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Generated At</div>
            <div className="text-sm font-semibold text-slate-950">
              {new Date(report.generatedAt).toLocaleString()}
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="text-sm font-semibold text-slate-950">Generate customer PDF</div>
          <div className="mt-1 text-xs text-slate-600">
            Select one customer or All Customers. You can generate as many customer reports as required for this Load Plan.
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <SelectInput
                label="Customer"
                value={selectedCustomer}
                options={customerOptions}
                onChange={setSelectedCustomer}
              />
            </div>
            <button
              className="primary-button h-10"
              onClick={() => onGenerate(selectedCustomer)}
            >
              <FileText size={16} />
              Generate Report
            </button>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </ModalShell>
  );
};

const FreightDetailsModal = ({ item, onClose, onEdit, onRotate, onDelete, onPreview }: any) => (
  <ModalShell title="Freight Details" eyebrow="Freight" onClose={onClose}>
    <div>{item.description}</div>
    <div className="flex gap-2 mt-4">
      <button className="secondary-button" onClick={onEdit}>Edit</button>
      <button className="secondary-button" onClick={onRotate}>Rotate</button>
      <button className="danger-button" onClick={onDelete}>Delete</button>
    </div>
  </ModalShell>
);

const SettingsSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4">
    <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
    <div className="mt-3 space-y-3">{children}</div>
  </div>
);

// ============================================================
// SIGNATURE COMPONENTS
// ============================================================
function SignaturePad({ label, signedBy, captured, onSave, onClear }: { label: string; signedBy: string; captured: SignatureState | null; onSave: (signature: SignatureState) => void; onClear: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
    if (captured?.dataUrl) {
      const image = new Image();
      image.onload = () => ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = captured.dataUrl;
    }
  }, [captured]);
  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !drawingRef.current) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(event.clientX - rect.left, event.clientY - rect.top);
    ctx.stroke();
  };
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(event.clientX - rect.left, event.clientY - rect.top);
  };
  const stop = () => { drawingRef.current = false; };
  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    onClear();
  };
const save = () => {
  const canvas = canvasRef.current;
  const ctx = canvas?.getContext("2d");

  if (!canvas) return;

  onSave({
    dataUrl: canvas.toDataURL("image/png"),
    timestamp: new Date().toLocaleString(),
    signedBy
  });

  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
};
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-950">{label}</div>
          <div className="mt-1 text-xs text-slate-500">
            {captured ? `Captured ${captured.timestamp}` : ''}
          </div>
        </div>
        <Signature className={captured ? "text-emerald-600" : "text-blue-600"} size={22} />
      </div>
      <canvas
        ref={canvasRef}
        className="mt-4 h-36 w-full touch-none rounded-lg border border-dashed border-slate-300 bg-white"
        width={620}
        height={160}
        onPointerDown={start}
        onPointerMove={draw}
        onPointerUp={stop}
        onPointerLeave={stop}
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="secondary-button justify-center" onClick={clear}>Clear Signature</button>
        <button className="primary-button justify-center" onClick={save}>Save Signature</button>
      </div>
    </div>
  );
}

function SignaturePreview({ label, signature }: { label: string; signature: SignatureState | null }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase text-slate-500">{label} Signature</div>
      {signature ? (
        <>
          <img className="mt-2 h-16 w-full rounded bg-white object-contain" src={signature.dataUrl} alt={`${label} signature`} />
          <div className="mt-2 text-xs text-slate-500">{signature.timestamp}</div>
        </>
      ) : (
        <div className="mt-2 grid h-16 place-items-center rounded bg-white text-xs text-slate-400">Not captured</div>
      )}
    </div>
  );
}

// ============================================================
// DASHBOARD / UI HELPERS
// ============================================================
function DashboardMetric({ label, value, tone = "blue", icon: Icon = BarChart3 }: { label: string; value: string; tone?: "blue" | "green" | "amber" | "red"; icon?: LucideIcon }) {
  const toneClass = { blue: "border-blue-100 bg-gradient-to-br from-blue-50 to-white text-blue-700 ring-blue-100", green: "border-emerald-100 bg-gradient-to-br from-emerald-50 to-white text-emerald-700 ring-emerald-100", amber: "border-amber-100 bg-gradient-to-br from-amber-50 to-white text-amber-700 ring-amber-100", red: "border-red-100 bg-gradient-to-br from-red-50 to-white text-red-700 ring-red-100" }[tone]; const iconClass = { blue: "bg-blue-600 text-white", green: "bg-emerald-600 text-white", amber: "bg-amber-500 text-white", red: "bg-red-600 text-white" }[tone];
  return (<div className={`rounded-lg border p-3 shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md ${toneClass}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0 text-xs font-semibold text-slate-600">{label}</div><div className={`grid h-8 w-8 shrink-0 place-items-center rounded-md shadow-sm ${iconClass}`}><Icon size={16} /></div></div><div className="mt-2 truncate text-2xl font-semibold tracking-normal">{value}</div></div>);
}

function DashboardDateFilter({ value, onChange }: { value: "Today" | "This Week" | "This Month" | "Custom Range"; onChange: (value: "Today" | "This Week" | "This Month" | "Custom Range") => void }) {
  const options = ["Today", "This Week", "This Month", "Custom Range"] as const; return <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">{options.map((option) => <button key={option} onClick={() => onChange(option)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${value === option ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}>{option}</button>)}{value === "Custom Range" && <><input className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600" type="date" /><input className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600" type="date" /></>}</div>;
}

function DashboardPanel({ title, action, children }: { title: string; action?: string; children: ReactNode }) { return (<div className="min-h-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><div className="text-sm font-semibold text-slate-950">{title}</div>{action && <div className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-100">{action}</div>}</div>{children}</div>); }

function MiniLineChart({ data }: { data: Array<{ label: string; loads: number; freight: number; weight: number }> }) {
  const max = Math.max(40, Math.ceil(Math.max(...data.flatMap((item) => [item.loads, item.freight, item.weight]), 1) / 10) * 10);
  const ticks = [0, 10, 20, 30, 40].filter((tick) => tick <= max);
  const chartTop = 30;
  const chartBottom = 220;
  const chartHeight = chartBottom - chartTop;
  const makePoints = (key: "loads" | "freight" | "weight") => data.map((item, index) => {
    const x = 42 + index * (238 / Math.max(1, data.length - 1));
    const y = chartBottom - (item[key] / max) * chartHeight;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="h-full min-h-[300px] rounded-lg bg-slate-50 p-3">
      <svg viewBox="0 0 300 260" preserveAspectRatio="none" className="h-full min-h-[300px] w-full">
        <defs>
          <linearGradient id="loadsGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => {
          const y = chartBottom - (tick / max) * chartHeight;
          return (
            <g key={tick}>
              <line x1="36" x2="286" y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x="28" y={y + 3} textAnchor="end" className="fill-slate-400 text-[8px] font-semibold">{tick}</text>
            </g>
          );
        })}
        <line x1="36" x2="286" y1={chartBottom} y2={chartBottom} stroke="#cbd5e1" strokeWidth="1.2" />
        <line x1="36" x2="36" y1={chartTop} y2={chartBottom} stroke="#cbd5e1" strokeWidth="1.2" />
        <polyline points={`42,${chartBottom + 6} ${makePoints("loads")} 280,${chartBottom + 6}`} fill="url(#loadsGradient)" stroke="none" />
        <polyline points={makePoints("loads")} fill="none" stroke="#2563eb" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
        <polyline points={makePoints("freight")} fill="none" stroke="#10b981" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        <polyline points={makePoints("weight")} fill="none" stroke="#f59e0b" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      </svg>
    </div>
  );
}

function TruckStatusVisual({ onSelect }: any) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="bg-emerald-100 p-2 rounded text-center text-sm">Available: 2</div>
      <div className="bg-blue-100 p-2 rounded text-center text-sm">In Use: 2</div>
      <div className="bg-amber-100 p-2 rounded text-center text-sm">Maintenance: 1</div>
    </div>
  );
}

function TrailerAvailabilityVisual({ trailers, onOpenStatus }: any) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {trailers.slice(0,4).map((t: any) => (
        <div key={t.id} className="text-xs p-1 border rounded">{t.number}: {t.dashboardStatus}</div>
      ))}
    </div>
  );
}

function TrailerDetailModal({ trailer, onClose }: any) {
  return (
    <ModalShell title="Trailer Details" eyebrow="Trailer" onClose={onClose}>
      <div>{trailer.number}</div>
    </ModalShell>
  );
}

function TrailerStatusModal({ status, trailers, onClose, onOpenTrailer }: any) {
  return (
    <ModalShell title={`${status} Trailers`} eyebrow="Fleet" onClose={onClose}>
      <div>{trailers.map((t: any) => t.number).join(", ")}</div>
    </ModalShell>
  );
}

function TruckDetailModal({ truck, onClose }: any) {
  return (
    <ModalShell title="Truck Details" eyebrow="Truck" onClose={onClose}>
      <div>{truck.number}</div>
    </ModalShell>
  );
}

// ============================================================
// PAGE COMPONENTS
// ============================================================
function PageCard({ title, eyebrow, icon: Icon, children }: { title: string; eyebrow: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-[0_18px_45px_rgba(0,0,0,0.14)] lg:overflow-hidden">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div><div className="text-xs font-semibold uppercase text-blue-600">{eyebrow}</div><h1 className="mt-1 text-xl font-semibold text-slate-950">{title}</h1></div>
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-200"><Icon size={20} /></div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function RecordCard({ active, title, subtitle, rows, onSelect, onEdit, onDelete, extra }: { active?: boolean; title: string; subtitle: string; rows: string[]; onSelect: () => void; onEdit: () => void; onDelete: () => void; extra?: ReactNode }) {
  return <div className={`rounded-lg border bg-white p-3 ${active ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"}`}><div className="flex items-start justify-between gap-3"><button className="min-w-0 text-left" onClick={onSelect}><div className="truncate text-sm font-semibold text-slate-950">{title}</div><div className="mt-1 truncate text-xs text-slate-500">{subtitle}</div></button><div className="flex shrink-0 gap-1"><IconAction title="Edit" icon={PenLine} onClick={onEdit} /><IconAction title="Delete" icon={Trash2} danger onClick={onDelete} /></div></div><div className="mt-3 grid gap-1 text-xs text-slate-600">{rows.map((row) => <div key={row} className="truncate">{row}</div>)}</div>{extra && <div className="mt-2">{extra}</div>}</div>;
}

function ReportCard({ report, onPreview, onDownload, onSend }: { report: GeneratedReport; onPreview: () => void; onDownload: () => void; onSend: () => void }) {
  return (
    <div className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-md hover:border-blue-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">{report.loadNumber}</div>
          <div className="mt-1 truncate text-xs text-slate-500">{report.customer} | {report.trailerNumber}</div>
        </div>
      </div>
      <div className="mt-2 text-xs text-slate-400">Generated {new Date(report.generatedAt).toLocaleString()}</div>
      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
        <IconAction title="Preview Report" icon={FileText} onClick={onPreview} />
        <IconAction title="Download PDF" icon={Download} onClick={onDownload} />
        <IconAction title="Send Customer Copy" icon={Mail} onClick={onSend} />
      </div>
    </div>
  );
}

// ============================================================
// APP COMPONENT (main)
// ============================================================
function App() {
  const [activePage, setActivePage] = useState<SidebarPage>("Load Plans");
  const [stepIndex, setStepIndex] = useState(0);
  const [loadPlan, setLoadPlan] = useState(initialLoadPlan);
  const [trucks, setTrucks] = useState(initialTrucks);
  const [trailers, setTrailers] = useState(initialTrailers);
  const [customers, setCustomers] = useState(initialCustomers);
  const [freightQueue, setFreightQueue] = useState<any[]>([]);
  const [freightItems, setFreightItems] = useState(initialFreight);
  const [conNotes, setConNotes] = useState(initialConNotes);
  const [settings, setSettings] = useState(initialSettings);
  const [reports, setReports] = useState(initialReports);
  const [aiPlanningReadiness, setAiPlanningReadiness] = useState(initialAiPlanningReadiness);
  const [selectedFreightId, setSelectedFreightId] = useState("");
  const [freightModal, setFreightModal] = useState<{ mode: "add" | "edit"; item: any } | null>(null);
  const [trailerModal, setTrailerModal] = useState<{ mode: "add" | "edit"; item: TrailerRecord } | null>(null);
  const [truckModal, setTruckModal] = useState<{ mode: "add" | "edit"; item: TruckRecord } | null>(null);
  const [trailerDocumentsModal, setTrailerDocumentsModal] = useState<TrailerRecord | null>(null);
  const [customerModal, setCustomerModal] = useState<{ mode: "add" | "edit"; item: CustomerRecord } | null>(null);
  const [reportPreview, setReportPreview] = useState<GeneratedReport | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<{ attachment: FreightAttachment; title: string } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
 const [driverSignature, setDriverSignature] = useState<SignatureState | null>(null);
const [forkliftSignature, setForkliftSignature] = useState<SignatureState | null>(null);

const [driverSignatures, setDriverSignatures] = useState<SignatureState[]>([]);
const [forkliftSignatures, setForkliftSignatures] = useState<SignatureState[]>([]);

const [successMessage, setSuccessMessage] = useState("");
  const [freightAllocationOpen, setFreightAllocationOpen] = useState(false);
  // 🟢 NEW: track whether allocator was opened from Create or Freight step
  const [allocationOpenedFrom, setAllocationOpenedFrom] = useState<"create" | "freight">("create");
  const [selectedQueueItems, setSelectedQueueItems] = useState<Set<string>>(new Set());
  const [driverDropdown, setDriverDropdown] = useState([...drivers]);
  const [truckDropdown, setTruckDropdown] = useState([...truckTypes]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState("");
  const [loadPlanId, setLoadPlanId] = useState<string | null>(null);
  const [loadPlanRowVersion, setLoadPlanRowVersion] = useState<number>(0);
  const [loadPlanSaving, setLoadPlanSaving] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [savedLoadPlans, setSavedLoadPlans] = useState<any[]>([]);
  const [savedLoadPlansLoading, setSavedLoadPlansLoading] = useState(false);
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const reportGeneratingRef = useRef(false);

  const selectedTrailer = trailers.find((item) => item.number === loadPlan.trailerNumber) ?? trailers[0];
  const trailerSpec = selectedTrailer;
  const selectedFreight = freightItems.find((item) => item.id === selectedFreightId) ?? null;
  const summary = useMemo(() => calculateSummary(freightItems, trailerSpec), [freightItems, trailerSpec]);

  const loadFreightQueue = async () => {
    setQueueLoading(true); setQueueError("");
    try { const result = await getFreightQueue(); setFreightQueue(result.items.map(mapFromApi)); }
    catch (err: any) { setQueueError(err.message || "Failed to load freight queue."); }
    finally { setQueueLoading(false); }
  };

  const loadSavedLoadPlans = async () => {
    setSavedLoadPlansLoading(true);
    try {
      const result = await listResumableLoadPlans();
      setSavedLoadPlans(result.items || []);
    } catch (err) {
      console.error("Failed to load saved Load Plans:", err);
    } finally {
      setSavedLoadPlansLoading(false);
    }
  };

  const loadPersistedReports = async () => {
    try {
      const result = await listGeneratedReports();
      const mapped: GeneratedReport[] = (result.items || []).map((r: any) => ({
        id: r.id,
        loadPlanId: r.loadPlanId,
        loadNumber: r.loadNumber,
        customer: r.customer || "",
        trailerNumber: r.trailerNumber || "",
        status: (r.status || "Generated") as GeneratedReport["status"],
        generatedAt: r.generatedAt,
        verificationId: r.verificationId,
        downloaded: Boolean(r.downloaded),
        sent: Boolean(r.sent)
      }));
      setReports(mapped);
    } catch (err) {
      console.error("Failed to load persisted reports:", err);
    }
  };

  const resetWorkingLoadPlan = () => {
    setLoadPlan(initialLoadPlan);
    setLoadPlanId(null);
    setLoadPlanRowVersion(0);
    setFreightItems([]);
    setSelectedFreightId("");
    setSelectedQueueItems(new Set());

setDriverSignature(null);
setForkliftSignature(null);

setDriverSignatures([]);
setForkliftSignatures([]);

setReviewError(null);
setAutoSaveState("idle");
    setFreightAllocationOpen(false);
    setAllocationOpenedFrom("create");
    setDetailsOpen(false);
  };

const mapAllocationToFreight = (alloc: any): FreightItem => ({
  id: alloc.freightQueueItemId,

  conNote:
    alloc.consignmentLine ||
    alloc.consignmentNumber ||
    "Unknown",

  consignmentLine:
    alloc.consignmentLine || "",

  consignment:
    alloc.consignmentNumber || "",

  product:
    alloc.productCode || "",

  customerName:
    alloc.customerName ||
    alloc.customerRef ||
    "",

  description:
    alloc.description || "Freight item",

  freightType:
    (alloc.freightType || "General Freight") as FreightKind,

  type:
    alloc.freightType || "GENERAL",

  number:
    alloc.quantity || 1,

  quantity:
    alloc.quantity || 1,

  lengthM:
    alloc.lengthM || 1,

  widthM:
    alloc.widthM || 1,

  heightM:
    alloc.heightM || 1,

  lengthCm:
    Number(
      alloc.lengthCm ??
      Math.round((alloc.lengthM || 1) * 100)
    ),

  widthCm:
    Number(
      alloc.widthCm ??
      Math.round((alloc.widthM || 1) * 100)
    ),

  heightCm:
    Number(
      alloc.heightCm ??
      Math.round((alloc.heightM || 1) * 100)
    ),

  weightKg:
    alloc.weightKg || 0,

  palletCount: 0,

  customerRef:
    alloc.customerName ||
    alloc.customerRef ||
    "",

  isDg:
    Boolean(alloc.isDg),

  dgClass:
    alloc.dgClass || "",

  dgUnId:
    alloc.dgUnId || "",

  dgWeightKg:
    alloc.dgWeightKg === null ||
    alloc.dgWeightKg === undefined
      ? null
      : Number(alloc.dgWeightKg),

  status: "loaded",

  xM:
    alloc.positionX || 0,

  yM:
    alloc.positionY || 0,

  rotated:
    alloc.rotationDegrees === 90 ||
    alloc.rotationDegrees === 270,

  attachments: [],

  dg:
    alloc.dgValue ||
    (alloc.isDg ? "DG" : "n/a"),

  allocated: true,

  allocatedToTrailer:
    alloc.trailerName || null,

  _rowVersion:
    alloc.allocationRowVersion,

  _apiBacked: true,

  _allocationId:
    alloc.id
});

  const openSavedLoadPlan = async (saved: any) => {
    const id = saved.id || saved.loadPlanId;
    if (!id) return;

    try {
      const plan: any = await getLoadPlan(id);
      const trailerNames = (plan.trailers || []).map((t: any) => t.trailer_name || t.trailerName).filter(Boolean);

      setLoadPlanId(id);
      setLoadPlanRowVersion(convertRowVersionFromApi(plan.row_version ?? plan.rowVersion));
     const rawDepartureTime = String(
  plan.departure_time || plan.departureTime || ""
);

let normalisedDepartureTime = "";

const isoTimeMatch = rawDepartureTime.match(/T(\d{2}):(\d{2})/);
const plainTimeMatch = rawDepartureTime.match(/^(\d{2}):(\d{2})/);

if (isoTimeMatch) {
  normalisedDepartureTime = `${isoTimeMatch[1]}:${isoTimeMatch[2]}`;
} else if (plainTimeMatch) {
  normalisedDepartureTime = `${plainTimeMatch[1]}:${plainTimeMatch[2]}`;
}

setLoadPlan({
  loadNumber: plan.load_plan_number || plan.loadPlanNumber || "",
  status: plan.status === "completed" ? "Completed" : "In Progress",
  customer: plan.customer_name || plan.customerName || "",
  driver: plan.driver_name || plan.driverName || "",
  forkliftOperator: "",
  truckType: plan.truck_name || plan.truckName || "",
  trailerType: "",
  trailerNumber: trailerNames[0] || "",
  trailerNumbers: trailerNames,
  origin: plan.origin || "",
  destination: plan.destination || "",
  departureDate: String(
    plan.departure_date || plan.departureDate || ""
  ).slice(0, 10),
  departureTime: normalisedDepartureTime
});

      if (trailerNames.length) {
        setTrailers(prev => {
          const existing = new Set(prev.map(t => t.number));
          const extras = trailerNames
            .filter((n: string) => !existing.has(n))
            .map((n: string, i: number) => ({
              id: `saved-${id}-${i}`, number: n, type: "Curtainsider", lengthM: 13.6, widthM: 2.4, heightM: 2.7, payloadKg: 24000, status: "In Use" as FleetStatus, documents: []
            }));
          return extras.length ? [...prev, ...extras] : prev;
        });
      }

      const allocationResult = await getFreightAllocations(id);
      setFreightItems((allocationResult.allocations || []).map(mapAllocationToFreight));

      try {
        const signatureResult = await getLoadPlanSignatures(id);
      const restoredDriverSignatures = (signatureResult.drivers || [])
  .filter((sig: any) => sig.signatureBase64)
  .map((sig: any) => ({
    dataUrl: sig.signatureBase64,
    timestamp: sig.updatedAtUtc || sig.signedAtUtc || "Saved",
    signedBy: sig.signerName || (plan.driver_name || plan.driverName || "Driver")
  }));

setDriverSignatures(restoredDriverSignatures);
setDriverSignature(
  restoredDriverSignatures.length
    ? restoredDriverSignatures[restoredDriverSignatures.length - 1]
    : null
);
       const restoredForkliftSignatures = (signatureResult.forklifts || [])
  .filter((sig: any) => sig.signatureBase64)
  .map((sig: any) => ({
    dataUrl: sig.signatureBase64,
    timestamp: sig.updatedAtUtc || sig.signedAtUtc || "Saved",
    signedBy: sig.signerName || "Forklift Operator"
  }));

setForkliftSignatures(restoredForkliftSignatures);

setForkliftSignature(
  restoredForkliftSignatures.length
    ? restoredForkliftSignatures[restoredForkliftSignatures.length - 1]
    : null
);

if (restoredForkliftSignatures.length) {
  setLoadPlan(prev => ({
    ...prev,
    forkliftOperator:
      restoredForkliftSignatures[restoredForkliftSignatures.length - 1].signedBy ||
      prev.forkliftOperator
  }));
}
        if (signatureResult.loadPlanRowVersion) setLoadPlanRowVersion(signatureResult.loadPlanRowVersion);
      } catch (signatureErr) {
        console.error("Failed to restore saved signatures:", signatureErr);
        setDriverSignature(null);
        setForkliftSignature(null);
      }

      const status = String(plan.status || "draft");
      const nextStep = status === "freight_allocated" ? 2 : status === "reviewed" || status === "signed" ? 4 : status === "completed" || status === "closed" ? 5 : 1;
      setStepIndex(nextStep);
      setSuccessMessage(`Opened ${plan.load_plan_number || plan.loadPlanNumber || "Load Plan"}.`);
      setTimeout(() => setSuccessMessage(""), 2200);
    } catch (err: any) {
      alert(err.message || "Failed to open saved Load Plan.");
    }
  };

  useEffect(() => { loadFreightQueue(); loadSavedLoadPlans(); loadPersistedReports(); }, []);

  useEffect(() => {
    (window as any).__setLoadPlanDirect = (updates: Partial<LoadPlanForm>) => setLoadPlan((prev: LoadPlanForm) => ({ ...prev, ...updates }));
    (window as any).__setStepIndex = (index: number) => setStepIndex(index);
    (window as any).__openFreightModal = () => setFreightModal({ mode: "add", item: emptyFreightDraft() });
    (window as any).__deleteQueueItem = (id: string) => { if (window.confirm("Delete this freight item?")) { deleteFreightQueueItem(id).then(() => loadFreightQueue()).catch((err: any) => alert(err.message)); } };
    (window as any).__editQueueItem = (item: any) => setFreightModal({ mode: "edit", item });
  }, []);

  // ============================================================
  // HANDLERS
  // ============================================================
  const validateLoadPlanForSave = () => {
    if (!loadPlan.loadNumber.trim() || loadPlan.loadNumber === "LP-2026-0001") {
      const year = new Date().getFullYear();
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      const newLoadNumber = `LP-${year}-${randomNum}`;
      setLoadPlan(prev => ({ ...prev, loadNumber: newLoadNumber }));
      loadPlan.loadNumber = newLoadNumber;
    }

    if (!loadPlan.driver.trim()) return "Driver is required.";
    if (!loadPlan.truckType.trim()) return "Truck is required.";
    if (!loadPlan.origin.trim()) return "Origin is required.";
    if (!loadPlan.destination.trim()) return "Destination is required.";
    if (!loadPlan.departureDate) return "Departure Date is required.";
    if (!loadPlan.departureTime) return "Departure Time is required.";
    const selectedTrailers = loadPlan.trailerNumbers.length ? loadPlan.trailerNumbers : [loadPlan.trailerNumber].filter(Boolean);
    if (selectedTrailers.length === 0) return "At least one trailer is required.";
    return "";
  };

  const saveNewLoadPlan = async () => {
    const validationError = validateLoadPlanForSave();
    if (validationError) return alert(validationError);

    const selectedTrailers = loadPlan.trailerNumbers.length ? loadPlan.trailerNumbers : [loadPlan.trailerNumber].filter(Boolean);
    setLoadPlanSaving(true);
    try {

     await createLoadPlan({
  loadPlanNumber: loadPlan.loadNumber.trim(),
  customerName: "",
  driverName: loadPlan.driver.trim(),
  truckName: loadPlan.truckType.trim(),
  origin: loadPlan.origin.trim(),
  destination: loadPlan.destination.trim(),
  departureDate: loadPlan.departureDate,
  departureTime: loadPlan.departureTime + ":00",
  trailers: selectedTrailers
});

      await loadSavedLoadPlans();
      const savedNumber = loadPlan.loadNumber;
      resetWorkingLoadPlan();
      setStepIndex(1);
      setSuccessMessage(`${savedNumber} saved. Open it from Saved Load Plans when ready to continue.`);
      setTimeout(() => setSuccessMessage(""), 3500);
    } catch (err: any) {
      alert(err.message || "Failed to save Load Plan.");
    } finally {
      setLoadPlanSaving(false);
    }
  };

  const handleAllocateFreight = async () => {
    if (!loadPlanId) {
      alert("Save the Load Plan first, then open it from Saved Load Plans to continue.");
      return;
    }

    const validationError = validateLoadPlanForSave();
    if (validationError) return alert(validationError);
    const selectedTrailers = loadPlan.trailerNumbers.length ? loadPlan.trailerNumbers : [loadPlan.trailerNumber].filter(Boolean);

    setLoadPlanSaving(true);
    try {
      const currentPlan: any = await getLoadPlan(loadPlanId);
      const freshRowVersion = convertRowVersionFromApi(currentPlan?.row_version ?? currentPlan?.rowVersion) || loadPlanRowVersion;

     const updated: any = await updateLoadPlanApi(loadPlanId, {
  loadPlanNumber: loadPlan.loadNumber.trim(),
  customerName: "",
  driverName: loadPlan.driver.trim(),
  truckName: loadPlan.truckType.trim(),
  origin: loadPlan.origin.trim(),
  destination: loadPlan.destination.trim(),
  departureDate: loadPlan.departureDate,
  departureTime: loadPlan.departureTime + (loadPlan.departureTime.length === 5 ? ":00" : ""),
  status: currentPlan?.status || "draft",
  trailers: selectedTrailers,
  rowVersion: freshRowVersion
});

      const nextRv = convertRowVersionFromApi(updated?.row_version ?? updated?.rowVersion);
      if (nextRv) setLoadPlanRowVersion(nextRv);
      await loadSavedLoadPlans();
      setAllocationOpenedFrom("create");
      setFreightAllocationOpen(true);
    } catch (err: any) {
      alert(err.message || "Failed to save Load Plan.");
    } finally {
      setLoadPlanSaving(false);
    }
  };
  
const updateLoadPlan = (field: keyof LoadPlanForm, value: string) => {
  setLoadPlan((current) => {
    if (field === "driver" && value && !driverDropdown.includes(value)) setDriverDropdown(prev => [...prev, value].sort());
    if (field === "truckType" && value && !truckDropdown.includes(value)) setTruckDropdown(prev => [...prev, value].sort());
    return { ...current, [field]: value };
  });
};

  // Auto-save metadata for an already-created/opened Load Plan.
  // New plans are explicitly created first because SQL requires all mandatory fields.
  useEffect(() => {
    if (!loadPlanId) return;
    const selectedTrailers = loadPlan.trailerNumbers.length ? loadPlan.trailerNumbers : [loadPlan.trailerNumber].filter(Boolean);
 const complete = Boolean(
  loadPlan.loadNumber.trim() &&
  loadPlan.driver.trim() &&
  loadPlan.truckType.trim() &&
  loadPlan.origin.trim() &&
  loadPlan.destination.trim() &&
  loadPlan.departureDate &&
  loadPlan.departureTime &&
  selectedTrailers.length
);
    if (!complete) return;

    setAutoSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        const currentPlan: any = await getLoadPlan(loadPlanId);
        const freshRowVersion = convertRowVersionFromApi(currentPlan?.row_version ?? currentPlan?.rowVersion) || loadPlanRowVersion;
      const updated: any = await updateLoadPlanApi(loadPlanId, {
  loadPlanNumber: loadPlan.loadNumber.trim(),
  customerName: "",
  driverName: loadPlan.driver.trim(),
  truckName: loadPlan.truckType.trim(),
  origin: loadPlan.origin.trim(),
  destination: loadPlan.destination.trim(),
  departureDate: loadPlan.departureDate,
  departureTime: loadPlan.departureTime + (loadPlan.departureTime.length === 5 ? ":00" : ""),
  status: currentPlan?.status || "draft",
  trailers: selectedTrailers,
  rowVersion: freshRowVersion
});
        const nextRv = convertRowVersionFromApi(updated?.row_version ?? updated?.rowVersion);
        if (nextRv) setLoadPlanRowVersion(nextRv);
        setAutoSaveState("saved");
        await loadSavedLoadPlans();
      } catch (err) {
        console.error("Load Plan auto-save failed:", err);
        setAutoSaveState("error");
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [
   loadPlanId,
loadPlan.loadNumber,
loadPlan.driver,
loadPlan.truckType,
loadPlan.origin,
loadPlan.destination,
loadPlan.departureDate,
loadPlan.departureTime,
loadPlan.trailerNumber,
loadPlan.trailerNumbers.join("|")
  ]);

  const assignFreightToTrailer = (trailerNumber: string) => {
    setFreightQueue(prev => prev.map(item => {
      if (selectedQueueItems.has(item.id) && !item.allocated) {
        return { 
          ...item, 
          allocated: true, 
          allocatedToTrailer: trailerNumber, 
          status: "loaded" as FreightStatus,
          lengthM: item.lengthM || 1,
          widthM: item.widthM || 1,
          heightM: item.heightM || 1,
          weightKg: item.weightKg || 0
        };
      }
      return item;
    }));
    
    const assigned = freightQueue
      .filter(item => selectedQueueItems.has(item.id) && !item.allocated)
      .map(item => ({ 
        ...item, 
        allocated: true, 
        allocatedToTrailer: trailerNumber, 
        status: "loaded" as FreightStatus,
        lengthM: item.lengthM || 1,
        widthM: item.widthM || 1,
        heightM: item.heightM || 1,
        weightKg: item.weightKg || 0
      }));
      
    setFreightItems(prev => { 
      const existingIds = new Set(prev.map(i => i.id)); 
      const newItems = assigned.filter(i => !existingIds.has(i.id)); 
      return [...prev, ...newItems]; 
    });
    
    setSelectedQueueItems(new Set());
    if (!loadPlan.trailerNumbers.includes(trailerNumber)) { 
      const nextTrailers = [...loadPlan.trailerNumbers, trailerNumber]; 
      setLoadPlan(prev => ({ ...prev, trailerNumbers: nextTrailers, trailerNumber: nextTrailers[0] })); 
    }
  };

  const removeFreightFromTrailer = (freightId: string) => { 
    setFreightItems(prev => prev.filter(i => i.id !== freightId)); 
    setFreightQueue(prev => prev.map(i => i.id === freightId ? { ...i, allocated: false, allocatedToTrailer: null, status: "loading" as FreightStatus, xM: 0, yM: 0 } : i)); 
  };
  
  const toggleQueueSelection = (id: string) => { 
    setSelectedQueueItems(prev => { 
      const next = new Set(prev); 
      if (next.has(id)) next.delete(id); 
      else next.add(id); 
      return next; 
    }); 
  };

  // 🟢 NEW: opens the Allocate Freight panel from the Freight step
  const openAllocationFromFreight = () => {
    setAllocationOpenedFrom("freight");
    setFreightAllocationOpen(true);
  };

  const handleContinueToSign = async () => {
    if (!loadPlanId) {
      setReviewError("No Load Plan ID found. Please go back and save the Load Plan.");
      return;
    }

    if (loadPlanRowVersion === 0) {
      setReviewError("No rowVersion found. Please refresh and try again.");
      return;
    }

    const trailerNumbers = loadPlan.trailerNumbers.length ? loadPlan.trailerNumbers : [loadPlan.trailerNumber].filter(Boolean);
    const warnings = [
      !loadPlan.driver ? "Missing Driver" : "",
      trailerNumbers.length === 0 ? "Missing Trailer" : "",
      freightItems.length === 0 ? "Missing Freight" : ""
    ].filter(Boolean);

    if (warnings.length > 0) {
      setReviewError(`Cannot review: ${warnings.join(", ")}`);
      return;
    }

    setIsReviewing(true);
    setReviewError(null);

    try {
      const freshPlan = await getLoadPlan(loadPlanId);
      let freshRowVersion = loadPlanRowVersion;
      if (freshPlan?.row_version) {
        freshRowVersion = convertRowVersionFromApi(freshPlan.row_version);
        setLoadPlanRowVersion(freshRowVersion);
      }

      const result = await confirmReview(loadPlanId, {
        rowVersion: freshRowVersion,
        warningCount: 0
      });

      if (result.rowVersion) {
        setLoadPlanRowVersion(result.rowVersion);
      }

      const win = window as any;
      if (win.__setStepIndex) {
        win.__setStepIndex(4);
      } else {
        setStepIndex(4);
      }

    } catch (err: any) {
      const errorMsg = err.message || "Failed to confirm review. Please try again.";
      
      if (errorMsg.includes("changed by another user") || errorMsg.includes("changed elsewhere")) {
        setReviewError("This Load Plan was changed by another user. Refresh and try again.");
      } else if (errorMsg.includes("must have confirmed freight")) {
        setReviewError("This Load Plan must have confirmed freight before it can be reviewed.");
      } else if (errorMsg.includes("not authorised")) {
        setReviewError("You are not authorised to review this Load Plan.");
      } else if (errorMsg.includes("not found")) {
        setReviewError("The Load Plan could not be found. Please go back and try again.");
      } else if (errorMsg.includes("network") || errorMsg.includes("connection")) {
        setReviewError("Unable to reach the Load Plans service. Please try again.");
      } else {
        setReviewError(errorMsg);
      }
    } finally {
      setIsReviewing(false);
    }
  };

  const saveTrailer = (item: TrailerRecord) => { 
    setTrailers((current) => current.some((t) => t.id === item.id) ? current.map((t) => t.id === item.id ? item : t) : [...current, item]); 
    setTrailerModal(null); 
  };
  
  const deleteTrailer = (id: string) => { 
    setTrailers((current) => current.filter((item) => item.id !== id)); 
  };
  
  const saveTruck = (item: TruckRecord) => { 
    setTrucks((current) => current.some((t) => t.id === item.id) ? current.map((t) => t.id === item.id ? item : t) : [...current, item]); 
    setTruckModal(null); 
  };
  
  const retireTruck = (id: string) => { 
    setTrucks((items) => items.map((truck) => truck.id === id ? { ...truck, status: "Retired", assignedTrailerNumbers: [] } : truck)); 
  };
  
  const changeTruckStatus = (id: string, status: FleetStatus) => { 
    setTrucks((items) => items.map((truck) => truck.id === id ? { ...truck, status, assignedTrailerNumbers: ["Maintenance", "Unavailable", "Retired"].includes(status) ? [] : truck.assignedTrailerNumbers } : truck)); 
  };
  
  const changeTrailerStatus = (id: string, status: FleetStatus) => { 
    setTrailers((items) => items.map((trailer) => trailer.id === id ? { ...trailer, status } : trailer)); 
  };
  
  const attachTrailerDocuments = (files: FileList | null, trailerNumber: string) => { 
    if (!files || !trailerNumber) return; 
    const documents = Array.from(files).filter((file) => ["image/jpeg", "image/png", "application/pdf"].includes(file.type)).map((file) => ({ 
      id: `doc-${crypto.randomUUID()}`, 
      name: file.name, 
      type: file.type === "application/pdf" ? "pdf" as const : "image" as const, 
      url: URL.createObjectURL(file) 
    })); 
    setTrailers((items) => items.map((trailer) => trailer.number === trailerNumber ? { ...trailer, documents: [...trailer.documents, ...documents] } : trailer)); 
  };
  
  const saveCustomer = (item: CustomerRecord) => { 
    setCustomers((current) => current.some((c) => c.id === item.id) ? current.map((c) => c.id === item.id ? item : c) : [...current, item]); 
    setCustomerModal(null); 
  };
  
  const deleteCustomer = (id: string) => { 
    setCustomers((current) => current.filter((item) => item.id !== id)); 
  };
  
  const moveFreight = (id: string, xM: number, yM: number) => {
    setFreightItems((items) => items.map((item) => {
      if (item.id !== id) return item;
      const trailer = trailers.find(t => t.number === item.allocatedToTrailer) ?? trailerSpec;
      const visibleLength = item.rotated ? item.widthM : item.lengthM;
      const visibleWidth = item.rotated ? item.lengthM : item.widthM;

      // Do not silently force oversized freight into the trailer.
      if (visibleLength > trailer.lengthM || visibleWidth > trailer.widthM) {
        return item;
      }

      return {
        ...item,
        xM: Number(clamp(xM, 0, trailer.lengthM - visibleLength).toFixed(2)),
        yM: Number(clamp(yM, 0, trailer.widthM - visibleWidth).toFixed(2))
      };
    }));
  };
  
  const rotateFreight = (id: string) => {
    let rejected = false;
    setFreightItems((items) => items.map((item) => {
      if (item.id !== id) return item;
      const trailer = trailers.find(t => t.number === item.allocatedToTrailer) ?? trailerSpec;
      const rotated = !item.rotated;
      const visibleLength = rotated ? item.widthM : item.lengthM;
      const visibleWidth = rotated ? item.lengthM : item.widthM;

      if (visibleLength > trailer.lengthM || visibleWidth > trailer.widthM) {
        rejected = true;
        return item;
      }

      return {
        ...item,
        rotated,
        xM: Number(clamp(item.xM, 0, trailer.lengthM - visibleLength).toFixed(2)),
        yM: Number(clamp(item.yM, 0, trailer.widthM - visibleWidth).toFixed(2))
      };
    }));
    if (rejected) {
      alert("This freight orientation does not fit within the selected trailer dimensions.");
    }
  };

  // ============================================================
  // 🟢 FIXED saveFreight – no longer sends rowVersion: 0
  // ============================================================
    // ============================================================
  // saveFreight — fetches fresh rowVersion by consignment line
  // ============================================================
  const saveFreight = async (item: any) => {
    try {
    const payload = {
  consignmentLine:
    item.consignmentLine?.trim() ||
    item.consignment?.trim() ||
    `FRT-${Date.now()}`,

  consignmentNumber:
    item.consignment?.trim() || "",

  productCode:
    item.product?.trim() || null,

  description:
    item.description?.trim() || "",

  freightType:
    item.freightType ||
    item.type ||
    "General Freight",

  quantity:
    Number(item.number || item.quantity || 1),

  weightKg:
    Number(item.weightKg || 0),

  lengthCm:
    Number(
      item.lengthCm ??
      Math.round((item.lengthM || 0) * 100)
    ),

  widthCm:
    Number(
      item.widthCm ??
      Math.round((item.widthM || 0) * 100)
    ),

  heightCm:
    Number(
      item.heightCm ??
      Math.round((item.heightM || 0) * 100)
    ),

  customerName:
    item.customerName?.trim() ||
    item.customerRef?.trim() ||
    "",

  isDg:
    Boolean(item.isDg),

  dgClass:
    item.isDg
      ? item.dgClass?.trim() || null
      : null,

  dgUnId:
    item.isDg
      ? item.dgUnId?.trim() || null
      : null,

  dgWeightKg:
    item.isDg
      ? Number(item.dgWeightKg || 0)
      : null,

  dgValue:
    item.isDg ? "DG" : "n/a",

  allocationStatus:
    item.allocated
      ? "allocated"
      : "unallocated"
};

      if (item._apiBacked) {
        let rowVersionNum = 0;

        // Always resolve the latest backend record by ID before updating.
        // This avoids reusing a stale rowVersion after a previous edit.
        try {
          const fresh = await getFreightQueue();
          const freshItem = fresh.items?.find((f: any) => f.id === item.id);

          if (freshItem) {
            rowVersionNum = convertRowVersionFromApi(freshItem.row_version);
            console.log("✅ Fresh rowVersion fetched:", rowVersionNum);
          }
        } catch (refreshErr) {
          console.warn("❌ Could not refresh rowVersion:", refreshErr);
        }

        if (rowVersionNum === 0) {
          rowVersionNum = typeof item._rowVersion === "number" ? item._rowVersion : 0;
          console.warn("⚠️ Using cached rowVersion:", rowVersionNum);
        }

        if (rowVersionNum === 0) {
          throw new Error("Could not determine rowVersion. Please refresh the freight queue and try again.");
        }

        console.log("📤 Sending PUT with rowVersion:", rowVersionNum);

        // Capture the updated backend record so we retain the new SQL rowVersion.
        const updatedApiItem = await updateFreightQueueItem(item.id, {
          ...payload,
          rowVersion: rowVersionNum
        });

        const updatedMappedItem = mapFromApi(updatedApiItem);

        // Keep the Queue copy current while preserving any local allocation/trailer state.
        setFreightQueue(prev =>
          prev.map(f =>
            f.id === item.id
              ? {
                  ...f,
                  ...updatedMappedItem,
                  allocated: item.allocated,
                  allocatedToTrailer: item.allocatedToTrailer,
                  status: item.status,
                  xM: item.xM,
                  yM: item.yM,
                  rotated: item.rotated,
                  attachments: item.attachments ?? f.attachments
                }
              : f
          )
        );

        // Keep the Freight-step / right-hand Selected Freight preview current.
        // Preserve trailer placement while replacing editable freight fields and rowVersion.
        setFreightItems(prev =>
          prev.map(f =>
            f.id === item.id
              ? {
                  ...f,
                  ...updatedMappedItem,
                  allocated: f.allocated,
                  allocatedToTrailer: f.allocatedToTrailer,
                  status: f.status,
                  xM: f.xM,
                  yM: f.yM,
                  rotated: f.rotated,
                  attachments: f.attachments
                }
              : f
          )
        );
      } else {
        const createdApiItem = await createFreightQueueItem(payload);
        const createdMappedItem = mapFromApi(createdApiItem);
        setFreightQueue(prev => [...prev, createdMappedItem]);
      }

      setFreightModal(null);
      setSuccessMessage("Freight saved successfully.");
      setTimeout(() => setSuccessMessage(""), 2800);

      // Final server refresh keeps the Queue authoritative.
      await loadFreightQueue();
    } catch (err: any) {
      alert(err.message || "Failed to save freight.");
    }
  };
  
  const deleteFreight = async (id: string) => { 
    if (!window.confirm("Delete this freight item?")) return; 
    try { 
      await deleteFreightQueueItem(id); 
      setDetailsOpen(false); 
      setSuccessMessage("Freight deleted."); 
      setTimeout(() => setSuccessMessage(""), 2800); 
      await loadFreightQueue(); 
    } catch (err: any) { alert(err.message || "Failed to delete freight."); } 
  };
  
  const attachFiles = (files: FileList | null, freightId = selectedFreightId) => { 
    if (!files || !freightId) return; 
    const attachments = Array.from(files).filter((file) => ["image/jpeg", "image/png", "application/pdf"].includes(file.type)).map((file) => ({ 
      id: `att-${crypto.randomUUID()}`, 
      name: file.name, 
      type: file.type === "application/pdf" ? "pdf" as const : "image" as const, 
      url: URL.createObjectURL(file) 
    })); 
    setFreightItems((items) => items.map((item) => item.id === freightId ? { ...item, attachments: [...item.attachments, ...attachments] } : item)); 
  };
  
  const attachLoadIqFiles = (files: FileList | null) => { 
    if (!files) return; 
    const accepted = Array.from(files).filter((file) => classifyAttachment(file)); 
    accepted.forEach((file) => { 
      const type = classifyAttachment(file); 
      if (!type) return; 
      const attachment: FreightAttachment = { 
        id: `ai-${crypto.randomUUID()}`, 
        name: file.name, 
        type, 
        url: URL.createObjectURL(file) 
      }; 
      if (type === "csv") { 
        file.text().then((previewText) => setAiPlanningReadiness((current) => ({ 
          ...current, 
          attachments: [...current.attachments, { ...attachment, previewText }] 
        }))); 
      } else { 
        setAiPlanningReadiness((current) => ({ 
          ...current, 
          attachments: [...current.attachments, attachment] 
        })); 
      } 
    }); 
  };
  
  const saveConNote = (item: ConNote) => { 
    setConNotes((items) => items.some((existing) => existing.id === item.id) ? items.map((existing) => existing.id === item.id ? item : existing) : [...items, item]); 
  };

 const handleSaveSignature = async (
  role: "driver" | "forklift-operator",
  signature: SignatureState
) => {
  if (!loadPlanId) {
    alert("Open a saved Load Plan before signing.");
    return;
  }

  try {
    await saveLoadPlanSignature(loadPlanId, role, {
      signerName:
        signature.signedBy ||
        (role === "driver"
          ? loadPlan.driver
          : loadPlan.forkliftOperator || "Forklift Operator"),
      signatureBase64: signature.dataUrl,
      mimeType: "image/png"
    });

    if (role === "driver") {
      setDriverSignature(signature);
      setDriverSignatures(prev => [...prev, signature]);
    } else {
      setForkliftSignature(signature);
      setForkliftSignatures(prev => [...prev, signature]);
    }

    const fresh: any = await getLoadPlan(loadPlanId);
    const rv = convertRowVersionFromApi(
      fresh?.row_version ?? fresh?.rowVersion
    );

    if (rv) setLoadPlanRowVersion(rv);

    setSuccessMessage(
      `${role === "driver" ? "Driver" : "Forklift Operator"} signature saved.`
    );

    setTimeout(() => setSuccessMessage(""), 2200);
  } catch (err: any) {
    alert(err.message || "Failed to save signature.");
  }
};

 const handleCompleteLoad = async () => {
  if (!loadPlanId) return alert("No Load Plan is open.");

  if (driverSignatures.length === 0 || forkliftSignatures.length === 0) {
    return alert(
      "At least one Driver signature and one Forklift Operator signature are required before completing the load."
    );
  }
    try {
      const fresh: any = await getLoadPlan(loadPlanId);
      const rowVersion = convertRowVersionFromApi(fresh?.row_version ?? fresh?.rowVersion) || loadPlanRowVersion;
      const result = await completeLoadPlan(loadPlanId, rowVersion);
      const nextRv = convertRowVersionFromApi(result?.row_version ?? result?.rowVersion);
      if (nextRv) setLoadPlanRowVersion(nextRv);
      setLoadPlan(prev => ({ ...prev, status: "Completed" }));
      await loadSavedLoadPlans();
      setStepIndex(5);
    } catch (err: any) {
      alert(err.message || "Failed to complete Load Plan.");
    }
  };
  
const generateReport = async (selectedCustomer: string = "All Customers") => {
  if (!loadPlanId || reportGeneratingRef.current) return;

  reportGeneratingRef.current = true;

  try {
    const trailerLabel =
      loadPlan.trailerNumbers.length > 1
        ? loadPlan.trailerNumbers.join(", ")
        : loadPlan.trailerNumber;

    const generatedAt = new Date().toISOString();
    const verificationId = `ELX-${Math.floor(
      100000 + Math.random() * 899999
    )}`;

    const persisted: any = await saveGeneratedReportApi(loadPlanId, {
  generatedAt,
  verificationId,
  customerName: selectedCustomer
});

    const next: GeneratedReport = {
      id: persisted?.id || `rep-${crypto.randomUUID()}`,
      loadPlanId,
      loadNumber: persisted?.loadNumber || loadPlan.loadNumber,
      customer: persisted?.customer || selectedCustomer,
      trailerNumber: persisted?.trailerNumber || trailerLabel,
      status: (
        persisted?.status ||
        (summary.exceptionCount > 0 ? "Requires Review" : "Generated")
      ) as GeneratedReport["status"],
      generatedAt: persisted?.generatedAt || generatedAt,
      verificationId: persisted?.verificationId || verificationId,
      downloaded: Boolean(persisted?.downloaded),
      sent: Boolean(persisted?.sent)
    };

    setReports((items) => [
      next,
      ...items.filter((item) => item.id !== next.id)
    ]);

    await Promise.all([
      loadPersistedReports(),
      loadSavedLoadPlans(),
      loadFreightQueue()
    ]);

    // Keep the completed Load Plan open on the Report tab.
    // Do NOT reset the working Load Plan here.
    setLoadPlan((prev) => ({
      ...prev,
      status: "Completed"
    }));

    setStepIndex(5);

    setSuccessMessage(
      `${loadPlan.loadNumber} report generated successfully.`
    );

    setTimeout(() => setSuccessMessage(""), 3500);

  } catch (err: any) {
    alert(err.message || "Failed to save generated report.");
  } finally {
    reportGeneratingRef.current = false;
  }
};

  const downloadReport = async (reportId?: string) => {
    const target = reportId ? reports.find((item) => item.id === reportId) : reports.find((item) => item.loadNumber === loadPlan.loadNumber);
    if (!target && !loadPlanId) {
      alert("No Load Plan ID found. Please complete a new load plan and try again.");
      return;
    }

    const targetId = target?.loadPlanId || loadPlanId;

    if (!targetId) {
      alert("Invalid Load Plan ID. Please complete a new load plan.");
      return;
    }

    try {
      const generatedAt = target?.generatedAt || new Date().toISOString();
      const url = `${apiBase}/load-plans/${targetId}/report/download?generatedAt=${encodeURIComponent(generatedAt)}`;

      const response = await fetch(url);
      if (!response.ok) throw new Error("Download failed");

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `load-plan-${target?.loadNumber || loadPlan.loadNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      setReports((items) => items.map((item) => item.id === reportId ? { ...item, downloaded: true } : item));
    } catch (err) {
      alert("Failed to download the report from the server.");
    }
  };
  
  const sendCustomerCopy = (reportId?: string) => {
    const currentReport = reportId ? reports.find((item) => item.id === reportId) : reports.find((item) => item.loadNumber === loadPlan.loadNumber);
    if (!currentReport) { generateReport(); return; }
    const subject = encodeURIComponent(`ELX Load Plan Report ${currentReport.loadNumber}`);
    const body = encodeURIComponent(`Hi,\n\nPlease find the customer copy for ${currentReport.loadNumber}.\n\nCustomer: ${currentReport.customer}\nTrailer: ${currentReport.trailerNumber}\nVerification: ${currentReport.verificationId}\n\nRegards,\nELX Logistics`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    setReports((items) => items.map((item) => item.id === currentReport.id ? { ...item, sent: true, status: "Customer Copy Sent" } : item));
  };
  
  const currentReport = reports.find((item) => item.loadNumber === loadPlan.loadNumber) ?? null;

  const renderMainContent = () => {
    if (activePage === "Dashboard") return (<DashboardPage loadPlan={loadPlan} trailers={trailers} freightItems={freightItems} reports={reports} summary={summary} driverSignature={driverSignature} forkliftSignature={forkliftSignature} />);
    if (activePage === "Truck Management") return <TruckManagementPage trucks={trucks} trailers={trailers} onAdd={() => setTruckModal({ mode: "add", item: makeTruckDraft() })} onEdit={(item) => setTruckModal({ mode: "edit", item })} onRetire={retireTruck} onStatusChange={changeTruckStatus} />;
    if (activePage === "Trailers") return <TrailersPage trailers={trailers} selectedTrailerNumber={loadPlan.trailerNumber} onAdd={() => setTrailerModal({ mode: "add", item: makeTrailerDraft() })} onEdit={(item) => setTrailerModal({ mode: "edit", item })} onDelete={deleteTrailer} onSelect={(item) => updateLoadPlan("trailerNumber", item.number)} onAttach={attachTrailerDocuments} onStatusChange={changeTrailerStatus} />;
    if (activePage === "Freight") return <FreightMasterPage freightItems={freightQueue} selectedFreightId={selectedFreightId} onSelect={setSelectedFreightId} onAdd={() => setFreightModal({ mode: "add", item: emptyFreightDraft() })} onEdit={(item) => setFreightModal({ mode: "edit", item })} onDelete={deleteFreight} onAttach={attachFiles} onPreview={(attachment, title) => setAttachmentPreview({ attachment, title })} />;
    if (activePage === "Customers") return <CustomersPage customers={customers} selectedCustomer={loadPlan.customer} onAdd={() => setCustomerModal({ mode: "add", item: makeCustomerDraft() })} onEdit={(item) => setCustomerModal({ mode: "edit", item })} onDelete={deleteCustomer} onSelect={(item) => updateLoadPlan("customer", item.name)} />;
    if (activePage === "Reports") return <ReportsPage reports={reports} onPreview={setReportPreview} onDownload={downloadReport} onSend={sendCustomerCopy}  onComplete={() => { /* Logic moved to Step5Sign */ }}/>;
    if (activePage === "Driver Schedule") return <DriverSchedulePage />;
    if (activePage === "Settings") return <SettingsPage settings={settings} onChange={setSettings} />;
    if (activePage === "LoadIQ Assistant") return <LoadIQPage readiness={aiPlanningReadiness} onUpload={(files) => attachLoadIqFiles(files)} onPreview={(attachment) => setAttachmentPreview({ attachment, title: "LoadIQ" })} />;
    return (
      <>
        <StepRail currentStep={stepIndex} onStepSelect={(index) => setStepIndex(index)} />
        <section className="min-h-0 flex-1">
          {stepIndex === 0 && <FreightQueueStep freightItems={freightQueue} selectedItems={selectedQueueItems} onToggleSelect={toggleQueueSelection} loading={queueLoading} error={queueError} />}
          {stepIndex === 1 && <CreateLoadPlanStep
  loadPlan={loadPlan}
  trailers={trailers}
  driverDropdown={driverDropdown}
  truckDropdown={truckDropdown}
  onChange={updateLoadPlan}

            onSaveNew={saveNewLoadPlan}
            onNew={() => { resetWorkingLoadPlan(); setStepIndex(1); }}
            onOpenAllocation={handleAllocateFreight}
            savedLoadPlans={savedLoadPlans}
            savedLoadPlansLoading={savedLoadPlansLoading}
            onOpenSaved={openSavedLoadPlan}
            saving={loadPlanSaving}
            autoSaveState={autoSaveState}
            isExisting={Boolean(loadPlanId)}
          />}
          {stepIndex === 2 && <FreightStep 
            trailerSpec={trailerSpec} 
            freightItems={freightItems} 
            selectedFreight={selectedFreight} 
            selectedFreightId={selectedFreightId} 
            onSelectFreight={setSelectedFreightId} 
            onMoveFreight={moveFreight} 
            onRotateFreight={rotateFreight} 
            onAddFreight={() => setFreightModal({ mode: "add", item: emptyFreightDraft() })} 
            onEditFreight={() => selectedFreight && setFreightModal({ mode: "edit", item: selectedFreight })} 
            onDeleteFreight={(id) => removeFreightFromTrailer(id)} 
            onAttachFiles={attachFiles} 
            onOpenDetails={() => setDetailsOpen(true)} 
            trailers={trailers} 
            trailerNumbers={loadPlan.trailerNumbers}
            loadPlanId={loadPlanId}
            loadPlan={loadPlan}
            loadPlanRowVersion={loadPlanRowVersion}
            setFreightItems={setFreightItems}
            setLoadPlanRowVersion={setLoadPlanRowVersion}
            setStepIndex={setStepIndex}
            onOpenAllocation={openAllocationFromFreight}
          />}
          {stepIndex === 3 && (
            <ReviewStep 
              loadPlan={loadPlan} 
              trailers={trailers} 
              freightItems={freightItems} 
              summary={summary} 
              driverSignature={driverSignature} 
              forkliftSignature={forkliftSignature}
              loadPlanId={loadPlanId}
              loadPlanRowVersion={loadPlanRowVersion}
              onContinueToSign={handleContinueToSign}
              isReviewing={isReviewing}
              reviewError={reviewError}
            />
          )}
          {stepIndex === 4 && (
  <SignStep
    loadPlan={loadPlan}
    driverSignature={driverSignature}
    forkliftSignature={forkliftSignature}
    driverSignatures={driverSignatures}
    forkliftSignatures={forkliftSignatures}
    onSaveDriver={(signature) => handleSaveSignature("driver", signature)}
    onSaveForklift={(signature) => handleSaveSignature("forklift-operator", signature)}
   onClearDriver={() => {}}
onClearForklift={() => {}}
    onComplete={handleCompleteLoad}
  />
)}
          {stepIndex === 5 && <ReportStep 
            loadPlan={loadPlan} 
            trailers={trailers} 
            freightItems={freightItems} 
            summary={summary} 
            driverSignature={driverSignature} 
            forkliftSignature={forkliftSignature} 
            reports={reports}
            currentReport={currentReport} 
            onGenerate={generateReport} 
            onDownload={downloadReport} 
            onSend={sendCustomerCopy} 
          />}
        </section>
        {freightAllocationOpen && (
          <FreightAllocationPanel
            freightQueue={freightQueue}
            selectedItems={selectedQueueItems}
            onToggleSelect={toggleQueueSelection}
            trailers={trailers}
            trailerNumbers={loadPlan.trailerNumbers}
            onAssign={assignFreightToTrailer}
            onClose={() => setFreightAllocationOpen(false)}
            setFreightQueueParent={setFreightQueue}
            setFreightItemsParent={setFreightItems}
            onConfirmAllocation={() => {
              setFreightAllocationOpen(false);
              if (allocationOpenedFrom === "create") {
                setTimeout(() => {
                  setStepIndex(2);
                }, 200);
              }
            }}
          />
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-[#07101f] text-slate-950"><div className="flex min-h-screen lg:h-screen lg:overflow-hidden"><Sidebar activePage={activePage} onPageChange={setActivePage} /><main className="flex min-w-0 flex-1 flex-col gap-3 overflow-x-hidden p-3 lg:h-screen lg:overflow-hidden lg:p-4"><MobileTopBar onLoadPlans={() => setActivePage("Load Plans")} />{renderMainContent()}</main></div>
    {freightModal && <FreightFormModal mode={freightModal.mode} item={freightModal.item} onClose={() => setFreightModal(null)} onSave={saveFreight} />}
    {trailerModal && <TrailerModal mode={trailerModal.mode} item={trailerModal.item} onClose={() => setTrailerModal(null)} onSave={saveTrailer} />}
    {truckModal && <TruckModal mode={truckModal.mode} item={truckModal.item} trailers={trailers} onClose={() => setTruckModal(null)} onSave={saveTruck} />}
    {trailerDocumentsModal && <TrailerDocumentsModal trailer={trailerDocumentsModal} onClose={() => setTrailerDocumentsModal(null)} onPreview={(attachment: FreightAttachment) => setAttachmentPreview({ attachment, title: trailerDocumentsModal.number })} />}
    {customerModal && <CustomerModal mode={customerModal.mode} item={customerModal.item} onClose={() => setCustomerModal(null)} onSave={saveCustomer} />}
    {reportPreview && (
  <ReportPreviewModal
    report={reportPreview}
    freightItems={freightItems}
    onGenerate={generateReport}
    onClose={() => setReportPreview(null)}
  />
)}
    {detailsOpen && selectedFreight && <FreightDetailsModal item={selectedFreight} onClose={() => setDetailsOpen(false)} onEdit={() => setFreightModal({ mode: "edit", item: selectedFreight })} onRotate={() => rotateFreight(selectedFreight.id)} onDelete={() => deleteFreight(selectedFreight.id)} onPreview={(attachment: FreightAttachment) => setAttachmentPreview({ attachment, title: selectedFreight.conNote })} />}
    {attachmentPreview && <AttachmentPreviewModal attachment={attachmentPreview.attachment} title={attachmentPreview.title} onClose={() => setAttachmentPreview(null)} />}
    {successMessage && <div className="fixed right-4 top-4 z-50 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-2xl shadow-emerald-950/10"><span className="inline-flex items-center gap-2"><CheckCircle2 size={18} />{successMessage}</span></div>}
    </div>
  );
}

// ============================================================
// WORKFLOW & STEP COMPONENTS
// ============================================================
function StepRail({ currentStep, onStepSelect }: { currentStep: number; onStepSelect: (index: number) => void }) {
  return <div className="rounded-lg border border-white/10 bg-[#0b1628] p-2 text-white lg:h-[58px]"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{workflowSteps.map((step, index) => { const Icon = step.icon; const active = index === currentStep; const complete = index < currentStep; return <button key={step.key} onClick={() => onStepSelect(index)} className={`flex h-10 min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs font-semibold transition ${active ? "bg-blue-600 text-white shadow-lg shadow-blue-950/30" : complete ? "bg-white/10 text-blue-200 hover:bg-white/15" : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"}`}><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-black/20">{complete ? <CheckCircle2 size={14} /> : <Icon size={14} />}</span><span className="truncate">{index + 1}. {step.short}</span></button>; })}</div></div>;
}

function WorkflowCard({ title, eyebrow, icon: Icon, children }: { title: string; eyebrow: string; icon: LucideIcon; children: ReactNode }) {
  return <section className="flex h-full min-h-[520px] flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-[0_18px_45px_rgba(0,0,0,0.14)] lg:min-h-0 lg:overflow-hidden"><div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-3"><div><div className="text-xs font-semibold uppercase text-blue-600">{eyebrow}</div><h2 className="mt-1 text-xl font-semibold text-slate-950">{title}</h2></div><div className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-200"><Icon size={20} /></div></div><div className="min-h-0 flex-1">{children}</div></section>;
}

// ============================================================
// STEP 1: Freight Queue
// ============================================================
function FreightQueueStep({ freightItems, selectedItems, onToggleSelect, loading, error }: { freightItems: any[]; selectedItems: Set<string>; onToggleSelect: (id: string) => void; loading?: boolean; error?: string }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");

  const types = Array.from(
    new Set(
      freightItems
        .filter((f: any) => !f.allocated)
        .map((f: any) => f.type)
    )
  ).sort();

  const filtered = freightItems.filter((item: any) => {
    if (item.allocated) return false;

    const searchText = search.toLowerCase();

    const matchesSearch =
      !search ||
      String(item.customerName || "").toLowerCase().includes(searchText) ||
      String(item.description || "").toLowerCase().includes(searchText) ||
      String(item.consignment || "").toLowerCase().includes(searchText);

    const matchesType =
      typeFilter === "All" ||
      item.type === typeFilter;

    return matchesSearch && matchesType;
  });

  return (
    <WorkflowCard title="Freight Queue" eyebrow="Step 1" icon={Boxes}>
      {loading && (
        <div className="py-4 text-center text-sm text-slate-500">
          Loading freight queue...
        </div>
      )}

      {error && (
        <div className="py-4 text-center text-sm text-red-600">
          Error: {error}
        </div>
      )}

      <div className="mb-2 flex justify-end">
        <button
          className="primary-button text-xs"
          onClick={() => {
            const win = window as any;
            if (win.__openFreightModal) win.__openFreightModal();
          }}
        >
          <Plus size={14} />
          Add Freight
        </button>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <TextInput
          label="Search"
          value={search}
          onChange={setSearch}
        />

        <SelectInput
          label="Type"
          value={typeFilter}
          options={["All", ...types]}
          onChange={setTypeFilter}
        />

        <div className="flex items-end">
          <button
            className="secondary-button w-full justify-center"
            onClick={() => {
              setSearch("");
              setTypeFilter("All");
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="w-10 p-2 text-left font-semibold text-slate-600">
                Sel
              </th>

              <th className="p-2 text-left font-semibold text-slate-600">
                Customer
              </th>

              <th className="p-2 text-left font-semibold text-slate-600">
                Consignment
              </th>

              <th className="p-2 text-left font-semibold text-slate-600">
                Description
              </th>

              <th className="p-2 text-left font-semibold text-slate-600">
                Type
              </th>

              <th className="p-2 text-center font-semibold text-slate-600">
                Quantity
              </th>

              <th className="p-2 text-right font-semibold text-slate-600">
                Weight
              </th>

              <th className="p-2 text-right font-semibold text-slate-600">
                Length
              </th>

              <th className="p-2 text-right font-semibold text-slate-600">
                Width
              </th>

              <th className="p-2 text-right font-semibold text-slate-600">
                Height
              </th>

              <th className="p-2 text-center font-semibold text-slate-600">
                DG
              </th>

              <th className="p-2 text-center font-semibold text-slate-600">
                Status
              </th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((item: any) => (
              <tr
                key={item.id}
                className={`cursor-pointer border-t border-slate-100 hover:bg-blue-50/30 ${
                  selectedItems.has(item.id) ? "bg-blue-50" : ""
                }`}
                onClick={() => onToggleSelect(item.id)}
              >
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={selectedItems.has(item.id)}
                    onChange={() => onToggleSelect(item.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>

                <td className="p-2 font-semibold text-slate-700">
                  {item.customerName || item.customerRef || "-"}
                </td>

                <td className="p-2 font-mono">
                  {item.consignment || "-"}
                </td>

                <td className="max-w-[220px] truncate p-2">
                  {item.description}
                </td>

                <td className="p-2">
                  {item.type}
                </td>

                <td className="p-2 text-center">
                  {item.number ?? item.quantity ?? 1}
                </td>

                <td className="p-2 text-right">
                  {formatKg(item.weightKg)}
                </td>

                <td className="p-2 text-right">
                  {Number(item.lengthCm ?? Math.round((item.lengthM || 0) * 100))} cm
                </td>

                <td className="p-2 text-right">
                  {Number(item.widthCm ?? Math.round((item.widthM || 0) * 100))} cm
                </td>

                <td className="p-2 text-right">
                  {Number(item.heightCm ?? Math.round((item.heightM || 0) * 100))} cm
                </td>

                <td className="p-2 text-center">
                  {item.isDg ? (
                    <span
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700"
                      title="Dangerous Goods"
                    >
                      ✓
                    </span>
                  ) : (
                    <span
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700"
                      title="Not Dangerous Goods"
                    >
                      ✕
                    </span>
                  )}
                </td>

                <td className="p-2 text-center">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    Unallocated
                  </span>

                  <button
                    className="ml-1 text-[10px] text-blue-400 hover:text-blue-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      const win = window as any;
                      if (win.__editQueueItem) win.__editQueueItem(item);
                    }}
                    title="Edit"
                  >
                    ✎
                  </button>

                  <button
                    className="ml-1 text-[10px] text-red-400 hover:text-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      const win = window as any;
                      if (win.__deleteQueueItem) win.__deleteQueueItem(item.id);
                    }}
                    title="Delete"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && !loading && (
          <div className="p-8 text-center text-sm text-slate-500">
            No unallocated freight items found.
          </div>
        )}
      </div>
    </WorkflowCard>
  );
}
// ============================================================
// STEP 2: Create Load Plan
// ============================================================
function CreateLoadPlanStep({
  loadPlan, trailers, driverDropdown, truckDropdown, onChange,
  onSaveNew, onNew, onOpenAllocation, savedLoadPlans, savedLoadPlansLoading,
  onOpenSaved, saving, autoSaveState, isExisting
}: {
  loadPlan: LoadPlanForm;
  trailers: TrailerRecord[];
  driverDropdown: string[];
  truckDropdown: string[];
  onChange: (field: keyof LoadPlanForm, value: string) => void;
  onSaveNew: () => void;
  onNew: () => void;
  onOpenAllocation: () => void;
  savedLoadPlans: any[];
  savedLoadPlansLoading: boolean;
  onOpenSaved: (item: any) => void;
  saving?: boolean;
  autoSaveState: "idle" | "saving" | "saved" | "error";
  isExisting: boolean;
}) {
  const selectedTrailers = loadPlan.trailerNumbers.length ? loadPlan.trailerNumbers : [loadPlan.trailerNumber].filter(Boolean);
  const [trailerInput, setTrailerInput] = useState("");
  const [localTrailerOptions, setLocalTrailerOptions] = useState<string[]>([]);
  const allTrailerOptions = [...new Set([...trailers.filter(t => !["Maintenance", "Unavailable", "Retired"].includes(t.status)).map(t => t.number), ...localTrailerOptions])].sort();

  const toggleTrailer = (number: string) => {
    const next = selectedTrailers.includes(number) ? selectedTrailers.filter(n => n !== number) : [...selectedTrailers, number];
    const safeNext = next.length ? next : [number];
    const win = window as any;
    if (win.__setLoadPlanDirect) win.__setLoadPlanDirect({ trailerNumbers: safeNext, trailerNumber: safeNext[0] });
  };

  const addTrailer = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!selectedTrailers.includes(trimmed)) toggleTrailer(trimmed);
    if (!allTrailerOptions.includes(trimmed)) setLocalTrailerOptions(prev => [...prev, trimmed].sort());
    setTrailerInput("");
  };

  const statusLabel = (item: any) => String(item.status || "draft").replace(/_/g, " ");

  return (
    <WorkflowCard title="Create Load Plan" eyebrow="Step 2" icon={ClipboardList}>
      <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-0 overflow-auto pr-1">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-950">{isExisting ? `Open Load Plan: ${loadPlan.loadNumber}` : "New Load Plan"}</div>
              <div className="text-xs text-slate-500">
                {isExisting
                  ? autoSaveState === "saving" ? "Auto-saving changes..." : autoSaveState === "error" ? "Auto-save failed - check connection." : "Changes are auto-saved to SQL."
                  : "Complete the required details, then save it to the Saved Load Plans list."}
              </div>
            </div>
            <button className="secondary-button text-xs" onClick={onNew}><Plus size={14} />New Load Plan</button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <TextInput label="Load Plan Number" value={loadPlan.loadNumber} onChange={(value) => onChange("loadNumber", value)} />
            
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-500">Driver</span>
              <input className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" list="driver-list" value={loadPlan.driver} onChange={(e) => onChange("driver", e.target.value)} />
              <datalist id="driver-list">{driverDropdown.map(d => <option key={d} value={d} />)}</datalist>
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-500">Truck</span>
              <input className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" list="truck-list" value={loadPlan.truckType} onChange={(e) => onChange("truckType", e.target.value)} />
              <datalist id="truck-list">{truckDropdown.map(t => <option key={t} value={t} />)}</datalist>
            </label>
            <TextInput label="Origin" value={loadPlan.origin} onChange={(value) => onChange("origin", value)} />
            <TextInput label="Destination" value={loadPlan.destination} onChange={(value) => onChange("destination", value)} />
            <TextInput label="Departure Date" type="date" value={loadPlan.departureDate} onChange={(value) => onChange("departureDate", value)} />
            <TextInput label="Departure Time" type="time" value={loadPlan.departureTime} onChange={(value) => onChange("departureTime", value)} />
            <div className="sm:col-span-2 xl:col-span-3">
              <span className="mb-1 block text-xs font-medium text-slate-500">Trailers</span>
              <div className="mb-1 flex min-h-[28px] flex-wrap gap-1">
                {selectedTrailers.map(tn => (
                  <span key={tn} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
                    {tn}<button onClick={() => toggleTrailer(tn)} className="font-bold text-blue-500 hover:text-red-600">&times;</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <input className="h-10 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" placeholder="Type or select trailer..." value={trailerInput} onChange={(e) => setTrailerInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTrailer(trailerInput); } }} list="trailer-options-list" />
                <datalist id="trailer-options-list">{allTrailerOptions.filter(t => !selectedTrailers.includes(t)).map(t => <option key={t} value={t} />)}</datalist>
                <button className="primary-button h-10 px-3 text-xs" onClick={() => addTrailer(trailerInput)}>Add</button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
            {!isExisting && <button className="primary-button" onClick={onSaveNew} disabled={saving}>{saving ? "Saving..." : <><CheckCircle2 size={16} />Save Load Plan</>}</button>}
            {isExisting && <button className="primary-button" onClick={onOpenAllocation} disabled={saving}><Plus size={16} />Allocate / Continue Freight</button>}
          </div>
        </div>

        <aside className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
            <div>
              <div className="text-sm font-semibold text-slate-950">Saved Load Plans</div>
              <div className="text-[11px] text-slate-500">Unfinished plans stay here until a report is generated.</div>
            </div>
            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">{savedLoadPlans.length}</span>
          </div>
          <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-auto">
            {savedLoadPlansLoading ? (
              <div className="py-6 text-center text-xs text-slate-500">Loading saved Load Plans...</div>
            ) : savedLoadPlans.length === 0 ? (
              <div className="rounded-md bg-white p-4 text-center text-xs text-slate-500 ring-1 ring-slate-200">No active saved Load Plans.</div>
            ) : savedLoadPlans.map((item: any) => {
              const number = item.load_plan_number || item.loadPlanNumber || "Load Plan";
              const customer = item.customer_name || item.customerName || "-";
              return (
                <div key={item.id} className="rounded-md bg-white p-3 ring-1 ring-slate-200">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-950">{number}</div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">{customer}</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold capitalize text-blue-700 ring-1 ring-blue-200">{statusLabel(item)}</span>
                  </div>
                  <button className="secondary-button mt-2 w-full justify-center text-xs" onClick={() => onOpenSaved(item)}>Open / Resume</button>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </WorkflowCard>
  );
}

// ============================================================
// FREIGHT ALLOCATION PANEL
// ============================================================
function FreightAllocationPanel({ freightQueue, selectedItems, onToggleSelect, trailers, trailerNumbers, onAssign, onClose, setFreightQueueParent, setFreightItemsParent, onConfirmAllocation }: { 
  freightQueue: any[]; 
  selectedItems: Set<string>; 
  onToggleSelect: (id: string) => void; 
  trailers: TrailerRecord[]; 
  trailerNumbers: string[]; 
  onAssign: (trailerNumber: string) => void; 
  onClose: () => void; 
  setFreightQueueParent: React.Dispatch<React.SetStateAction<any[]>>; 
  setFreightItemsParent: React.Dispatch<React.SetStateAction<FreightItem[]>>; 
  onConfirmAllocation: () => void 
}) {
  const [activeTrailer, setActiveTrailer] = useState(trailerNumbers?.[0] || "");
  if (!trailerNumbers || trailerNumbers.length === 0) {
    return (
      <ModalShell title="Allocate Freight to Trailers" eyebrow="Freight Allocation" onClose={onClose}>
        <div className="p-4 text-amber-600">Please add a trailer first before allocating freight.</div>
        <div className="mt-4 flex justify-end gap-2 border-t border-slate-200 pt-3">
          <button className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </ModalShell>
    );
  }
  const safeSelectedItems = selectedItems || new Set<string>();
  const unallocated = (freightQueue || []).filter((f: any) => f && !f.allocated);
  const allocatedToTrailer = (freightQueue || []).filter((f: any) => f && f.allocatedToTrailer === activeTrailer);
  const handleRemove = (itemId: string) => {
    if (!itemId) return;
    setFreightItemsParent((prev: FreightItem[]) => prev.filter(i => i && i.id !== itemId));
    setFreightQueueParent((prev: any[]) => prev.map(i => {
      if (i && i.id === itemId) {
        return { ...i, allocated: false, allocatedToTrailer: null, status: "loading" as FreightStatus, xM: 0, yM: 0 };
      }
      return i;
    }));
  };
  return (
    <ModalShell title="Allocate Freight to Trailers" eyebrow="Freight Allocation" onClose={onClose}>
      <div className="flex gap-2 mb-3 flex-wrap">
        {trailerNumbers.map(tn => (
          <button key={tn} onClick={() => setActiveTrailer(tn)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${activeTrailer === tn ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
            {tn}
          </button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-950 mb-2">Unallocated Freight</div>
          <div className="max-h-[400px] overflow-auto grid gap-1">
            {unallocated.length === 0 ? (
              <div className="text-xs text-slate-400 p-2">All items allocated.</div>
            ) : (
              unallocated.map((item: any) => (
                <button key={item.id} onClick={() => onToggleSelect(item.id)} className={`text-left rounded-md border p-2 text-xs transition ${safeSelectedItems.has(item.id) ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-200"}`}>
                  <div className="font-semibold">{item.description || "Unknown"}</div>
                  <div className="text-slate-500">{item.consignmentLine || ""} | {formatKg(item.weightKg || 0)}</div>
                </button>
              ))
            )}
          </div>
          {safeSelectedItems.size > 0 && (
            <button className="primary-button mt-2 w-full justify-center" onClick={() => onAssign(activeTrailer)}>
              Assign Selected to {activeTrailer}
            </button>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-sm font-semibold text-slate-950 mb-2">{activeTrailer} – Allocated Freight</div>
          <div className="max-h-[400px] overflow-auto grid gap-1">
            {allocatedToTrailer.length === 0 ? (
              <div className="text-xs text-slate-400 p-2">No freight assigned yet.</div>
            ) : (
              allocatedToTrailer.map((item: any) => (
                <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs flex justify-between items-center">
                  <div>
                    <div className="font-semibold">{item.description || "Unknown"}</div>
                    <div className="text-slate-500">{item.consignmentLine || ""} | {formatKg(item.weightKg || 0)}</div>
                  </div>
                  <button className="text-red-500 hover:text-red-700 text-[10px] font-semibold" onClick={() => handleRemove(item.id)}>Remove</button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-slate-200 pt-3">
        <button className="secondary-button" onClick={onClose}>Cancel</button>
        <button className="primary-button" onClick={() => onConfirmAllocation()}>
          <CheckCircle2 size={18} />Confirm Allocation
        </button>
      </div>
    </ModalShell>
  );
}

// ============================================================
// STEP 3: Freight / Trailer Layout
// ============================================================
function FreightStep({ trailerSpec, freightItems, selectedFreight, selectedFreightId, onSelectFreight, onMoveFreight, onRotateFreight, onAddFreight, onEditFreight, onDeleteFreight, onAttachFiles, onOpenDetails, trailers, trailerNumbers, loadPlanId, loadPlan, loadPlanRowVersion, setFreightItems, setLoadPlanRowVersion, setStepIndex, onOpenAllocation }: { 
  trailerSpec: TrailerRecord; 
  freightItems: FreightItem[]; 
  selectedFreight: FreightItem | null; 
  selectedFreightId: string; 
  onSelectFreight: (id: string) => void; 
  onMoveFreight: (id: string, xM: number, yM: number) => void; 
  onRotateFreight: (id: string) => void; 
  onAddFreight: () => void; 
  onEditFreight: () => void; 
  onDeleteFreight: (id: string) => void; 
  onAttachFiles: (files: FileList | null, freightId?: string) => void; 
  onOpenDetails: () => void; 
  trailers: TrailerRecord[]; 
  trailerNumbers: string[];
  loadPlanId: string | null;
  loadPlan: LoadPlanForm;
  loadPlanRowVersion: number;
  setFreightItems: React.Dispatch<React.SetStateAction<FreightItem[]>>;
  setLoadPlanRowVersion: React.Dispatch<React.SetStateAction<number>>;
  setStepIndex: React.Dispatch<React.SetStateAction<number>>;
  onOpenAllocation: () => void;
}) {
  const [activeTrailerIndex, setActiveTrailerIndex] = useState(0);
  const currentTrailerNumber = trailerNumbers[activeTrailerIndex] || trailerNumbers[0];
  const currentTrailer = trailers.find(t => t.number === currentTrailerNumber) || trailerSpec;
  const trailerFreight = freightItems.filter(f => f.allocatedToTrailer === currentTrailerNumber);
  useEffect(() => {
    const loadSavedAllocations = async () => {
      if (!loadPlanId) return;
      try {
        const result = await getFreightAllocations(loadPlanId);
        if (result.allocations && result.allocations.length > 0) {
         const loadedFreight: FreightItem[] = result.allocations.map((alloc: any) => ({
  id: alloc.freightQueueItemId,

  conNote:
    alloc.consignmentLine ||
    alloc.consignmentNumber ||
    "Unknown",

  consignmentLine:
    alloc.consignmentLine || "",

  consignment:
    alloc.consignmentNumber || "",

  product:
    alloc.productCode || "",

  customerName:
    alloc.customerName ||
    alloc.customerRef ||
    "",

  description:
    alloc.description || "Freight item",

  freightType:
    (alloc.freightType || "General Freight") as FreightKind,

  type:
    alloc.freightType || "GENERAL",

  number:
    alloc.quantity || 1,

  quantity:
    alloc.quantity || 1,

  lengthM:
    alloc.lengthM || 1,

  widthM:
    alloc.widthM || 1,

  heightM:
    alloc.heightM || 1,

  lengthCm:
    Number(
      alloc.lengthCm ??
      Math.round((alloc.lengthM || 1) * 100)
    ),

  widthCm:
    Number(
      alloc.widthCm ??
      Math.round((alloc.widthM || 1) * 100)
    ),

  heightCm:
    Number(
      alloc.heightCm ??
      Math.round((alloc.heightM || 1) * 100)
    ),

  weightKg:
    alloc.weightKg || 0,

  palletCount: 0,

  customerRef:
    alloc.customerName ||
    alloc.customerRef ||
    "",

  isDg:
    Boolean(alloc.isDg),

  dgClass:
    alloc.dgClass || "",

  dgUnId:
    alloc.dgUnId || "",

  dgWeightKg:
    alloc.dgWeightKg === null ||
    alloc.dgWeightKg === undefined
      ? null
      : Number(alloc.dgWeightKg),

  status:
    "loaded" as FreightStatus,

  xM:
    alloc.positionX || 0,

  yM:
    alloc.positionY || 0,

  rotated:
    alloc.rotationDegrees === 90 ||
    alloc.rotationDegrees === 270,

  attachments: [],

  dg:
    alloc.dgValue ||
    (alloc.isDg ? "DG" : "n/a"),

  allocated: true,

  allocatedToTrailer:
    alloc.trailerName ||
    loadPlan.trailerNumber,

  _rowVersion:
    alloc.allocationRowVersion,

  _apiBacked: true,

  _allocationId:
    alloc.id
}));
          setFreightItems((current) => {
  if (current.length > 0) return current;
  return loadedFreight;
});
          if (result.loadPlanRowVersion) {
            setLoadPlanRowVersion(result.loadPlanRowVersion);
          }
        }
      } catch (err) {
        console.error("Failed to load saved allocations:", err);
      }
    };
    loadSavedAllocations();
  }, [loadPlanId]);

  // Auto-save the working trailer layout without advancing workflow status.
  useEffect(() => {
    if (!loadPlanId) return;

    const timer = window.setTimeout(async () => {
      try {
        const currentPlan: any = await getLoadPlan(loadPlanId);
        const trailerMap: Record<string, string> = {};
        (currentPlan?.trailers || []).forEach((t: any) => {
          trailerMap[t.trailer_name || t.trailerName] = t.id;
        });

        const invalid = freightItems.find((item) => {
          const trailerNumber = item.allocatedToTrailer || loadPlan.trailerNumber;
          const trailer = trailers.find(t => t.number === trailerNumber) || trailerSpec;
          const visibleLength = item.rotated ? item.widthM : item.lengthM;
          const visibleWidth = item.rotated ? item.lengthM : item.widthM;
          return item.xM < 0 || item.yM < 0 || visibleLength > trailer.lengthM || visibleWidth > trailer.widthM;
        });
        if (invalid) return;

        const allocations = freightItems.map((item, index) => {
          const trailerKey = item.allocatedToTrailer || loadPlan.trailerNumber;
          return {
            allocationId: item._allocationId,
            loadPlanTrailerId: trailerMap[trailerKey] || trailerKey,
            freightQueueItemId: item.id,
            positionX: item.xM || 0,
            positionY: item.yM || 0,
            rotationDegrees: item.rotated ? 90 : 0,
            sequenceNumber: index + 1
          };
        });

        await saveFreightAllocationDraft(loadPlanId, allocations);
      } catch (err) {
        console.error("Freight layout auto-save failed:", err);
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [loadPlanId, freightItems, loadPlan.trailerNumber, trailers, trailerSpec]);
  return (
    <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-h-0 rounded-lg border border-slate-200 bg-white p-3 shadow-[0_18px_45px_rgba(0,0,0,0.14)] flex flex-col">
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          {trailerNumbers.map((tn, idx) => (
            <button key={tn} onClick={() => setActiveTrailerIndex(idx)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${idx === activeTrailerIndex ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              {tn}
            </button>
          ))}
          {/* 🟢 NEW: reopen the allocator from Freight step */}
          <button className="secondary-button text-xs ml-auto" onClick={onOpenAllocation} title="Allocate Freight">
            <Plus size={14} />Allocate Freight
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <MultiTrailerTwin trailerSpec={currentTrailer} freightItems={trailerFreight} selectedFreightId={selectedFreightId} onSelectFreight={onSelectFreight} onMoveFreight={onMoveFreight} onRotateFreight={onRotateFreight} />
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <button className="secondary-button text-xs" onClick={() => selectedFreightId && onRotateFreight(selectedFreightId)}>
            <RotateCw size={14} />Rotate
          </button>
          <button className="primary-button text-xs ml-auto" onClick={async () => {
            if (freightItems.length === 0) { alert("No freight items to confirm."); return; }

            const invalidFreight = freightItems.find((item) => {
              const trailerNumber = item.allocatedToTrailer || loadPlan.trailerNumber;
              const trailer = trailers.find(t => t.number === trailerNumber) || trailerSpec;
              const visibleLength = item.rotated ? item.widthM : item.lengthM;
              const visibleWidth = item.rotated ? item.lengthM : item.widthM;
              return item.xM < 0 || item.yM < 0 || visibleLength > trailer.lengthM || visibleWidth > trailer.widthM;
            });

            if (invalidFreight) {
              const trailerNumber = invalidFreight.allocatedToTrailer || loadPlan.trailerNumber;
              alert(`Freight ${invalidFreight.consignmentLine || invalidFreight.id} does not fit within trailer ${trailerNumber}. Adjust or rotate it before confirming.`);
              return;
            }

            try {
              const currentPlan = await getLoadPlan(loadPlanId!);
              const freshRowVersion = currentPlan?.row_version ? convertRowVersionFromApi(currentPlan.row_version) : loadPlanRowVersion;
              const trailerMap: Record<string, string> = {};
              if (currentPlan?.trailers) {
                currentPlan.trailers.forEach((t: any) => {
                  trailerMap[t.trailer_name] = t.id;
                });
              }
              if (Object.keys(trailerMap).length === 0) {
                trailers.forEach(t => {
                  if (loadPlan.trailerNumbers.includes(t.number)) {
                    trailerMap[t.number] = t.id;
                  }
                });
              }
              const allocations = freightItems.map((item, index) => {
                const trailerKey = item.allocatedToTrailer || loadPlan.trailerNumber;
                const trailerId = trailerMap[trailerKey] || trailerKey;
                return {
                  allocationId: item._allocationId,
                  loadPlanTrailerId: trailerId,
                  freightQueueItemId: item.id,
                  positionX: item.xM || 0,
                  positionY: item.yM || 0,
                  rotationDegrees: item.rotated ? 90 : 0,
                  sequenceNumber: index + 1
                };
              });
              const payload = { loadPlanRowVersion: freshRowVersion, allocations: allocations };
              const result = await saveFreightAllocations(loadPlanId!, payload);
              if (result.success) {
                if (result.loadPlanRowVersion) {
                  setLoadPlanRowVersion(result.loadPlanRowVersion);
                }
                const win = window as any;
                if (win.__setStepIndex) win.__setStepIndex(3);
                else setStepIndex(3);
              }
            } catch (err: any) {
              if (err.message && err.message.includes("changed elsewhere")) {
                alert("Someone else has updated this Load Plan. Please refresh the page and try again.");
              } else {
                alert(err.message || "Failed to save freight layout. Please try again.");
              }
            }
          }}>
            <CheckCircle2 size={14} />Confirm Freight
          </button>
        </div>
      </section>
      <SelectedFreightPanel selectedFreight={selectedFreight} onOpenDetails={onOpenDetails} onEditFreight={onEditFreight} onDeleteFreight={() => selectedFreight && onDeleteFreight(selectedFreight.id)} onRotateFreight={onRotateFreight} onAttachFiles={onAttachFiles} />
    </div>
  );
}

function MultiTrailerTwin({ trailerSpec, freightItems, selectedFreightId, onSelectFreight, onMoveFreight, onRotateFreight }: { trailerSpec: TrailerRecord; freightItems: FreightItem[]; selectedFreightId: string; onSelectFreight: (id: string) => void; onMoveFreight: (id: string, xM: number, yM: number) => void; onRotateFreight: (id: string) => void }) {
  const boardRef = useRef<HTMLDivElement>(null); 
  const dragRef = useRef<{ id: string; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);
  useEffect(() => { 
    const move = (event: globalThis.PointerEvent) => { 
      const drag = dragRef.current; 
      const board = boardRef.current; 
      if (!drag || !board) return; 
      const rect = board.getBoundingClientRect(); 
      onMoveFreight(drag.id, drag.startX + ((event.clientX - drag.startClientX) / rect.width) * trailerSpec.lengthM, drag.startY + ((event.clientY - drag.startClientY) / rect.height) * trailerSpec.widthM); 
    }; 
    const up = () => { dragRef.current = null; }; 
    window.addEventListener("pointermove", move); 
    window.addEventListener("pointerup", up); 
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; 
  }, [onMoveFreight, trailerSpec.lengthM, trailerSpec.widthM]);
  const beginDrag = (event: PointerEvent<HTMLButtonElement>, item: FreightItem) => { 
    event.preventDefault(); 
    onSelectFreight(item.id); 
    dragRef.current = { id: item.id, startClientX: event.clientX, startClientY: event.clientY, startX: item.xM, startY: item.yM }; 
  };
  return (
    <div className="flex h-full min-h-[300px] flex-col lg:min-h-0">
      <div className="mb-2 text-xs font-semibold uppercase text-blue-600">Trailer {trailerSpec.number} – {trailerSpec.type}</div>
      <div className="min-h-0 flex-1 overflow-x-auto rounded-lg bg-white p-3 border border-slate-200">
        <div className="grid h-full min-h-[250px] min-w-[980px] place-items-center lg:min-h-0">
          <div ref={boardRef} className="trailer-board relative w-full rounded-md border-4 border-slate-700 bg-slate-200" style={{ aspectRatio: `${trailerSpec.lengthM} / ${trailerSpec.widthM}` }}>
            <div className="absolute inset-y-[8%] right-[-5.5%] w-[5%] rounded-r-2xl bg-slate-950 shadow-lg">
              <div className="absolute left-[15%] top-[18%] h-[22%] w-[62%] rounded-sm bg-blue-500/80" />
              <div className="absolute bottom-[18%] left-[15%] h-[22%] w-[62%] rounded-sm bg-blue-500/80" />
            </div>
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,.12)_1px,transparent_1px),linear-gradient(0deg,rgba(15,23,42,.10)_1px,transparent_1px)] bg-[size:7.35%_50%]" />
            <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-500/40" />
            <div className="absolute left-3 top-3 rounded bg-slate-950/80 px-2 py-1 text-xs font-semibold text-white">Rear</div>
            <div className="absolute right-3 top-3 rounded bg-slate-950/80 px-2 py-1 text-xs font-semibold text-white">Cab</div>
            {freightItems.map((item) => (
              <FreightBlock key={item.id} item={item} trailerSpec={trailerSpec} selected={item.id === selectedFreightId} onPointerDown={(event) => beginDrag(event, item)} onDoubleClick={() => onRotateFreight(item.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FreightBlock({ item, trailerSpec, selected, onPointerDown, onDoubleClick }: { item: FreightItem; trailerSpec: TrailerRecord; selected: boolean; onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void; onDoubleClick: () => void }) {
  if (!item || !trailerSpec) return null;

  const lengthM = item.lengthM || 0;
  const widthM = item.widthM || 0;

  const visibleLength = item.rotated ? widthM : lengthM;
  const visibleWidth = item.rotated ? lengthM : widthM;

  const customerName =
    item.customerName ||
    item.customerRef ||
    "Unknown Customer";

  const conNoteNumber =
    item.consignment ||
    item.conNote ||
    "Unknown";

  const freightType =
    item.freightType ||
    item.type ||
    "General Freight";

  const dgStyle = item.isDg
    ? "border-red-700 bg-red-600 text-white"
    : "border-emerald-700 bg-emerald-600 text-white";

  return (
    <motion.button
      layout
      type="button"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={`absolute flex touch-none select-none items-center justify-center overflow-hidden rounded-md border-2 p-2 text-center shadow-lg transition ${dgStyle} ${
        selected
          ? "ring-4 ring-blue-400/45"
          : "hover:ring-4 hover:ring-blue-300/30"
      }`}
      style={{
        left: `${(item.xM / trailerSpec.lengthM) * 100}%`,
        top: `${(item.yM / trailerSpec.widthM) * 100}%`,
        width: `${(visibleLength / trailerSpec.lengthM) * 100}%`,
        height: `${(visibleWidth / trailerSpec.widthM) * 100}%`
      }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex max-w-full flex-col items-start text-left text-[11px] font-bold leading-tight">
  <span className="max-w-full truncate">{customerName}</span>
  <span className="max-w-full truncate">{conNoteNumber}</span>
  <span className="max-w-full truncate">{freightType}</span>
</div>

    </motion.button>
  );
}

function SelectedFreightPanel({ selectedFreight, onOpenDetails, onEditFreight, onDeleteFreight, onRotateFreight, onAttachFiles }: { selectedFreight: FreightItem | null; onOpenDetails: () => void; onEditFreight: () => void; onDeleteFreight: () => void; onRotateFreight: (id: string) => void; onAttachFiles: (files: FileList | null, freightId?: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  if (!selectedFreight) return <aside className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-sm font-semibold text-slate-500">No freight selected</div></aside>;
  return (
    <aside className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-[0_18px_45px_rgba(0,0,0,0.14)]">
      <input ref={fileRef} className="hidden" type="file" multiple accept="image/*" onChange={(event) => onAttachFiles(event.currentTarget.files, selectedFreight.id)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-blue-600">Selected Freight</div>
          <h2 className="mt-1 truncate text-xl font-semibold text-slate-950">{selectedFreight.conNote}</h2>
          <p className="mt-1 truncate text-sm text-slate-500">{selectedFreight.description}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusStyles[selectedFreight.status].badge}`}>{statusStyles[selectedFreight.status].label}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <DetailBox label="Length" value={formatM(selectedFreight.lengthM)} />
        <DetailBox label="Width" value={formatM(selectedFreight.widthM)} />
        <DetailBox label="Height" value={formatM(selectedFreight.heightM)} />
        <DetailBox label="Weight" value={formatKg(selectedFreight.weightKg)} />
      </div>
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <PanelRow label="Pallets" value={String(selectedFreight.palletCount)} />
        <PanelRow label="Position" value={`${selectedFreight.xM.toFixed(1)} m / ${selectedFreight.yM.toFixed(1)} m`} />
      </div>
      <AttachmentPreview attachments={selectedFreight.attachments} compact />
      <div className="mt-auto grid gap-2 pt-3">
        <button className="secondary-button w-full justify-center" onClick={onOpenDetails}><Search size={18} />View Freight Details</button>
        <div className="flex gap-2">
          <IconAction title="Edit freight" icon={PenLine} onClick={onEditFreight} />
          <IconAction title="Attach files" icon={Upload} onClick={() => { if (fileRef.current) { fileRef.current.setAttribute("capture", ""); fileRef.current.click(); } }} />
          <IconAction title="Capture photo" icon={Camera} onClick={() => { if (fileRef.current) { fileRef.current.setAttribute("capture", "environment"); fileRef.current.setAttribute("accept", "image/*"); fileRef.current.click(); } }} />
          <IconAction title="Delete freight" icon={Trash2} danger onClick={onDeleteFreight} />
        </div>
        <button className="primary-button w-full justify-center" onClick={() => onRotateFreight(selectedFreight.id)}><RotateCw size={18} />Rotate Freight</button>
      </div>
    </aside>
  );
}

// ============================================================
// STEP 4: Review & Confirm
// ============================================================
function ReviewStep({ loadPlan, trailers, freightItems, summary, driverSignature, forkliftSignature, loadPlanId, loadPlanRowVersion, onContinueToSign, isReviewing, reviewError }: { loadPlan: LoadPlanForm; trailers: TrailerRecord[]; freightItems: FreightItem[]; summary: LoadSummary; driverSignature: SignatureState | null; forkliftSignature: SignatureState | null; loadPlanId: string | null; loadPlanRowVersion: number; onContinueToSign: () => Promise<void>; isReviewing: boolean; reviewError: string | null; }) {
  const trailerNumbers = loadPlan.trailerNumbers.length ? loadPlan.trailerNumbers : [loadPlan.trailerNumber].filter(Boolean);
  const warnings = [
    !loadPlan.driver ? "Missing Driver" : "",
    trailerNumbers.length === 0 ? "Missing Trailer" : "",
    freightItems.length === 0 ? "Missing Freight" : ""
  ].filter(Boolean);
  const totalWeight = freightItems.reduce((s, i) => s + i.weightKg, 0);
  return (
    <WorkflowCard title="Review & Confirm" eyebrow="Step 4" icon={ClipboardCheck}>
      <div className="grid min-h-0 gap-3 xl:grid-cols-[1fr_1fr_320px]">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-950">Load Plan Summary</div>
          <div className="mt-3 grid gap-2">
            <PanelRow label="Load Plan" value={loadPlan.loadNumber} />
            <PanelRow label="Customer" value={loadPlan.customer} />
            <PanelRow label="Driver" value={loadPlan.driver || "Missing"} />
            <PanelRow label="Truck" value={loadPlan.truckType} />
            <PanelRow label="Route" value={`${loadPlan.origin} to ${loadPlan.destination}`} />
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-950">Trailers & Freight</div>
          <div className="mt-3 grid gap-2">
            {trailerNumbers.map(tn => {
              const trailer = trailers.find(t => t.number === tn);
              const tf = freightItems.filter(f => f.allocatedToTrailer === tn);
              return (
                <div key={tn} className="rounded-md bg-slate-50 p-2 text-xs">
                  <div className="font-semibold">{tn} ({trailer?.type || "Unknown"}) – {tf.length} items, {formatKg(tf.reduce((s, i) => s + i.weightKg, 0))}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-950">Live Metrics</div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <DetailBox label="Total Items" value={String(freightItems.length)} />
            <DetailBox label="Total Weight" value={formatKg(totalWeight)} />
            <DetailBox label="Trailers" value={String(trailerNumbers.length)} />
          </div>
        </div>
      </div>
      {reviewError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle size={16} className="inline-block mr-2" />
          {reviewError}
        </div>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {warnings.length === 0 ? (
          <button onClick={onContinueToSign} disabled={isReviewing || !loadPlanId} className={`w-full text-left hover:ring-2 hover:ring-emerald-300 rounded-lg transition cursor-pointer ${isReviewing ? 'opacity-50 cursor-wait' : ''}`}>
            <ValidationCard type="ok" text={isReviewing ? "Confirming Review..." : "All review checks look good — Continue to Sign"} />
          </button>
        ) : (
          warnings.map((warning) => <ValidationCard key={warning} type="warning" text={warning} />)
        )}
      </div>
    </WorkflowCard>
  );
}

// ============================================================
// STEP 5: Sign & Complete
// ============================================================
function SignStep({
  loadPlan,
  driverSignature,
  forkliftSignature,
  driverSignatures,
  forkliftSignatures,
  onSaveDriver,
  onSaveForklift,
  onClearDriver,
  onClearForklift,
  onComplete
}: {
  loadPlan: LoadPlanForm;
  driverSignature: SignatureState | null;
  forkliftSignature: SignatureState | null;
  driverSignatures: SignatureState[];
  forkliftSignatures: SignatureState[];
  onSaveDriver: (signature: SignatureState) => void;
  onSaveForklift: (signature: SignatureState) => void;
   onClearDriver: () => void;
  onClearForklift: () => void;
  onComplete: () => void;
}) {
  const [driverSignerName, setDriverSignerName] = useState(loadPlan.driver || "");
  const [forkliftSignerName, setForkliftSignerName] = useState(
    loadPlan.forkliftOperator || ""
  );

  return (
    <WorkflowCard title="Sign & Complete" eyebrow="Step 5" icon={Signature}>
      <div className="grid min-h-0 gap-3 lg:grid-cols-[1fr_1fr_260px]">
<div className="space-y-3">
  <TextInput
    label="Driver Name"
    value={driverSignerName}
    onChange={setDriverSignerName}
  />

<SignaturePad
  key={`driver-${driverSignatures.length}`}
  label="Driver Signature"
  signedBy={driverSignerName}
  captured={null}
  onSave={onSaveDriver}
  onClear={onClearDriver}
/>

  {driverSignatures.length > 0 && (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase text-slate-500">
        Saved Driver Signatures
      </div>

      {driverSignatures.map((signature, index) => (
        <div
          key={`${signature.signedBy}-${signature.timestamp}-${index}`}
          className="rounded-lg border border-slate-200 bg-white p-3"
        >
          <div className="text-sm font-semibold text-slate-950">
            {signature.signedBy || `Driver ${index + 1}`}
          </div>

          <img
            src={signature.dataUrl}
            alt={`Driver signature ${index + 1}`}
            className="mt-2 h-14 w-full rounded bg-slate-50 object-contain"
          />

          <div className="mt-2 text-xs text-slate-500">
            {signature.timestamp}
          </div>
        </div>
      ))}
    </div>
  )}
</div>

<div className="space-y-3">
  <TextInput
    label="Forklift Operator Name"
    value={forkliftSignerName}
    onChange={setForkliftSignerName}
  />

<SignaturePad
  key={`forklift-${forkliftSignatures.length}`}
  label="Forklift Operator Signature"
  signedBy={forkliftSignerName}
  captured={null}
  onSave={(signature) => {
    if (!forkliftSignerName.trim()) {
      alert("Forklift Operator Name is required before saving the signature.");
      return;
    }

    onSaveForklift({
      ...signature,
      signedBy: forkliftSignerName.trim()
    });
  }}
  onClear={onClearForklift}
/>

  {forkliftSignatures.length > 0 && (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase text-slate-500">
        Saved Forklift Signatures
      </div>

      {forkliftSignatures.map((signature, index) => (
        <div
          key={`${signature.signedBy}-${signature.timestamp}-${index}`}
          className="rounded-lg border border-slate-200 bg-white p-3"
        >
          <div className="text-sm font-semibold text-slate-950">
            {signature.signedBy || `Forklift Operator ${index + 1}`}
          </div>

          <img
            src={signature.dataUrl}
            alt={`Forklift signature ${index + 1}`}
            className="mt-2 h-14 w-full rounded bg-slate-50 object-contain"
          />

          <div className="mt-2 text-xs text-slate-500">
            {signature.timestamp}
          </div>
        </div>
      ))}
    </div>
  )}
</div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900"><CheckCircle2 size={18} />Complete load</div>
          <p className="mt-2 text-sm leading-6 text-emerald-800">Marks this load complete, updates shared report state, and refreshes dashboard metrics.</p>
          <div className="mt-3 rounded-lg bg-white p-3 text-sm ring-1 ring-emerald-100">
            <PanelRow label="Load" value={loadPlan.loadNumber} />
            <PanelRow label="Status" value={loadPlan.status} />
          </div>
          <button className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-lg shadow-emerald-950/10 transition hover:bg-emerald-700" onClick={onComplete}>
            <CheckCircle2 size={18} />Complete Load
          </button>
        </div>
      </div>
    </WorkflowCard>
  );
}

// ============================================================
// STEP 6: Generate Report
// ============================================================
function ReportStep({ loadPlan, trailers, freightItems, summary, driverSignature, forkliftSignature, reports, currentReport, onGenerate, onDownload, onSend }: {
  loadPlan: LoadPlanForm;
  trailers: TrailerRecord[];
  freightItems: FreightItem[];
  summary: LoadSummary;
  driverSignature: SignatureState | null;
  forkliftSignature: SignatureState | null;
  reports: GeneratedReport[];
  currentReport: GeneratedReport | null;
  onGenerate: (customer: string) => void;
  onDownload: (id?: string) => void;
  onSend: (id?: string) => void;
}) {
  const [dateRange, setDateRange] = useState<"Today" | "This Week" | "This Month" | "Custom Range">("Today");
  const [previewReport, setPreviewReport] = useState<GeneratedReport | null>(null);

  useEffect(() => {
    if (
      loadPlan.status === "Completed" &&
      loadPlan.loadNumber.trim() &&
      !reports.some((report) => report.loadNumber === loadPlan.loadNumber)
    ) {
      onGenerate("All Customers");
    }
  }, [loadPlan.status, loadPlan.loadNumber, reports, onGenerate]);

  const filteredReports = useMemo(() => {
    let filtered = reports;

    if (dateRange === "Today") {
      const today = new Date();
      filtered = filtered.filter((report) => {
        const date = new Date(report.generatedAt);
        return date.getFullYear() === today.getFullYear() &&
               date.getMonth() === today.getMonth() &&
               date.getDate() === today.getDate();
      });
    } else if (dateRange === "This Week") {
      const today = new Date();
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay() + 1);
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);
      filtered = filtered.filter((report) => {
        const date = new Date(report.generatedAt);
        return date >= startOfWeek && date <= endOfWeek;
      });
    } else if (dateRange === "This Month") {
      const today = new Date();
      filtered = filtered.filter((report) => {
        const date = new Date(report.generatedAt);
        return date.getFullYear() === today.getFullYear() &&
               date.getMonth() === today.getMonth();
      });
    }

    return filtered;
  }, [reports, dateRange]);

  return (
    <WorkflowCard title="Generate Report" eyebrow="Step 6" icon={FileText}>
      <div className="flex justify-end mb-2">
        <button className="secondary-button text-xs" onClick={() => { if (window.confirm("Close this Load Plan and return to Freight Queue?")) { const win = window as any; if (win.__setStepIndex) win.__setStepIndex(0); } }} title="Close Load Plan">
          <X size={14} />Close Load Plan
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DashboardDateFilter value={dateRange} onChange={setDateRange} />
      </div>

      <div className="mb-4 flex items-center gap-4 rounded-lg bg-blue-600 p-4 shadow-sm">
        <h1 className="text-xl font-semibold text-white">Load Plan Report</h1>
      </div>

      <div className="grid max-h-[calc(100vh-280px)] gap-3 overflow-auto lg:grid-cols-2 xl:grid-cols-3">
        {filteredReports.length === 0 ? (
          <div className="col-span-full py-8 text-center text-sm text-slate-500">
            Preparing Load Plan report...
          </div>
        ) : (
          filteredReports.map((item) => (
            <ReportCard
              key={item.id}
              report={item}
              onPreview={() => setPreviewReport(item)}
              onDownload={() => onDownload(item.id)}
              onSend={() => onSend(item.id)}
            />
          ))
        )}
      </div>

      {previewReport && (
        <ReportPreviewModal
          report={previewReport}
          freightItems={freightItems}
          onGenerate={onGenerate}
          onClose={() => setPreviewReport(null)}
        />
      )}
    </WorkflowCard>
  );
}

// ============================================================
// OTHER PAGE COMPONENTS
// ============================================================
function DashboardPage({ loadPlan, trailers, freightItems, reports, summary, driverSignature, forkliftSignature }: { loadPlan: LoadPlanForm; trailers: TrailerRecord[]; freightItems: FreightItem[]; reports: GeneratedReport[]; summary: LoadSummary; driverSignature: SignatureState | null; forkliftSignature: SignatureState | null; }) {
  const [dateRange, setDateRange] = useState<"Today" | "This Week" | "This Month" | "Custom Range">("Today");
  const rangeMultiplier = { Today: 1, "This Week": 2, "This Month": 4, "Custom Range": 3 }[dateRange];
  const uniqueLoadNumbers = new Set([loadPlan.loadNumber, ...reports.map((report) => report.loadNumber)]);
  const currentLoadComplete = Boolean(driverSignature && forkliftSignature && reports.some((report) => report.loadNumber === loadPlan.loadNumber && report.sent));
  const completedLoads = reports.filter((report) => report.status === "Customer Copy Sent").length + (currentLoadComplete ? 1 : 0);
  const inProgress = currentLoadComplete ? 0 : 1;
  const averageUtilisation = Math.round((summary.floorPercent + 68 + 57 + 74) / 4);
  const rangedTotalLoads = Math.max(uniqueLoadNumbers.size, uniqueLoadNumbers.size * rangeMultiplier);
  const rangedInProgress = Math.max(inProgress, Math.ceil(inProgress * Math.min(rangeMultiplier, 2)));
  const rangedCompleted = completedLoads * rangeMultiplier;
  const rangedFreight = summary.freightCount * rangeMultiplier;
  const rangedPallets = summary.palletCount * rangeMultiplier;
  const rangedWeight = summary.totalWeightKg * rangeMultiplier;
  const monthLoads = [
    { label: "W1", loads: Math.max(4, uniqueLoadNumbers.size + rangeMultiplier), freight: Math.max(6, summary.freightCount * rangeMultiplier), weight: Math.max(8, Math.round(summary.totalWeightKg / 650)) },
    { label: "W2", loads: Math.max(7, reports.length + 4 + rangeMultiplier), freight: Math.max(8, summary.freightCount * rangeMultiplier + 2), weight: Math.max(10, Math.round(summary.totalWeightKg / 600)) },
    { label: "W3", loads: Math.max(5, freightItems.length + rangeMultiplier), freight: Math.max(7, summary.freightCount * rangeMultiplier + 1), weight: Math.max(9, Math.round(summary.totalWeightKg / 620)) },
    { label: "W4", loads: Math.max(9, summary.palletCount + rangeMultiplier), freight: Math.max(10, summary.freightCount * rangeMultiplier + 4), weight: Math.max(12, Math.round(summary.totalWeightKg / 540)) },
    { label: "Now", loads: Math.max(6, uniqueLoadNumbers.size + reports.length + rangeMultiplier), freight: Math.max(8, summary.freightCount * rangeMultiplier + 2), weight: Math.max(10, Math.round(summary.totalWeightKg / 580)) }
  ];
  return (
    <PageCard title="Dashboard Overview" eyebrow="Operations" icon={Home}>
      <div className="grid h-full min-h-0 gap-3 overflow-auto pr-1 lg:overflow-hidden xl:grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex justify-end"><DashboardDateFilter value={dateRange} onChange={setDateRange} /></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <DashboardMetric label="Total Loads" value={String(rangedTotalLoads)} tone="blue" icon={ClipboardList} />
          <DashboardMetric label="In Progress" value={String(rangedInProgress)} tone="blue" icon={Truck} />
          <DashboardMetric label="Completed" value={String(rangedCompleted)} tone="green" icon={CheckCircle2} />
          <DashboardMetric label="Total Freight" value={String(rangedFreight)} tone="blue" icon={Boxes} />
          <DashboardMetric label="Total Pallets" value={String(rangedPallets)} tone="green" icon={Warehouse} />
          <DashboardMetric label="Total Weight" value={formatKg(rangedWeight)} tone="blue" icon={PackagePlus} />
          <DashboardMetric label="Average Floor Utilisation" value={`${averageUtilisation}%`} tone="green" icon={ShieldCheck} />
        </div>
        <OperationsCommandView averageUtilisation={averageUtilisation} monthLoads={monthLoads} trailers={trailers} loadPlan={loadPlan} summary={summary} />
      </div>
    </PageCard>
  );
}

function OperationsCommandView({ averageUtilisation, monthLoads, trailers, loadPlan, summary }: { averageUtilisation: number; monthLoads: Array<{ label: string; loads: number; freight: number; weight: number }>; trailers: TrailerRecord[]; loadPlan: LoadPlanForm; summary: LoadSummary }) {
  const dashboardTrailers = trailers.map((trailer, index) => { 
    const floorUtilisation = trailer.number === loadPlan.trailerNumber ? summary.floorPercent : [48, 48, 72, 0][index] ?? 0; 
    const payloadUtilisation = trailer.number === loadPlan.trailerNumber ? Math.round((summary.totalWeightKg / Math.max(1, trailer.payloadKg)) * 100) : [22, 31, 55, 0][index] ?? 0; 
    const dashboardStatus = trailer.number === loadPlan.trailerNumber || trailer.number === "TR-1134" ? "In Use" : trailer.status === "Maintenance" ? "Unavailable" : trailer.status; 
    const assignedLoad = trailer.number === loadPlan.trailerNumber ? loadPlan.loadNumber : trailer.number === "TR-1134" ? "LP-2024-0003" : "Unassigned"; 
    return { ...trailer, dashboardStatus, floorUtilisation, payloadUtilisation, assignedLoad }; 
  });
  const [trailerDetails, setTrailerDetails] = useState<DashboardTrailer | null>(null);
  const [trailerStatusDetails, setTrailerStatusDetails] = useState<{ status: "In Use" | "Available" | "Unavailable"; trailers: DashboardTrailer[] } | null>(null);
  const [truckDetails, setTruckDetails] = useState<DashboardTruck | null>(null);
  return (
    <>
      <div className="grid min-h-0 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 xl:grid-cols-[minmax(280px,.82fr)_minmax(320px,1fr)_minmax(0,1.32fr)]">
        <div className="grid min-h-0"><DashboardPanel title="Loads Trend" action={`${averageUtilisation}% floor avg`}><MiniLineChart data={monthLoads} /></DashboardPanel></div>
        <div className="grid min-h-0"><DashboardPanel title="Truck Status Visual"><TruckStatusVisual onSelect={setTruckDetails} /></DashboardPanel></div>
        <div className="grid min-h-0"><DashboardPanel title="Fleet & Trailer Visual Command" action={`${dashboardTrailers.filter((trailer) => trailer.dashboardStatus === "Available").length} available`}><TrailerAvailabilityVisual trailers={dashboardTrailers} onOpenStatus={setTrailerStatusDetails} /></DashboardPanel></div>
      </div>
      {trailerDetails && <TrailerDetailModal trailer={trailerDetails} onClose={() => setTrailerDetails(null)} />}
      {trailerStatusDetails && <TrailerStatusModal status={trailerStatusDetails.status} trailers={trailerStatusDetails.trailers} onClose={() => setTrailerStatusDetails(null)} onOpenTrailer={setTrailerDetails} />}
      {truckDetails && <TruckDetailModal truck={truckDetails} onClose={() => setTruckDetails(null)} />}
    </>
  );
}

type DashboardTrailer = TrailerRecord & { dashboardStatus: string; floorUtilisation: number; payloadUtilisation: number; assignedLoad: string; };
type DashboardTruck = TruckRecord;

function TruckManagementPage({ trucks, trailers, onAdd, onEdit, onRetire, onStatusChange }: { trucks: TruckRecord[]; trailers: TrailerRecord[]; onAdd: () => void; onEdit: (item: TruckRecord) => void; onRetire: (id: string) => void; onStatusChange: (id: string, status: FleetStatus) => void }) {
  const trailerLabels = Object.fromEntries(trailers.map((trailer) => [trailer.number, `${trailer.number} ${trailer.type}`]));
  return (
    <PageCard title="Truck Management" eyebrow="Fleet" icon={Truck}>
      <div className="flex justify-end mb-3"><button className="primary-button" onClick={onAdd}><Plus size={18} />Add Truck</button></div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {trucks.map((truck) => <div key={truck.id} className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-950">{truck.number}</div><div className="mt-1 truncate text-xs text-slate-500">{truck.make} {truck.model} | {truck.registration}</div></div><div className="flex shrink-0 gap-1"><IconAction title="Edit truck" icon={PenLine} onClick={() => onEdit(truck)} /><IconAction title="Retire truck" icon={Trash2} danger onClick={() => onRetire(truck.id)} /></div></div><div className="mt-3 grid gap-1 text-xs text-slate-600"><PanelRow label="Status" value={truck.status} /><PanelRow label="Driver" value={truck.driver} /><PanelRow label="Location" value={truck.location} /><PanelRow label="Trailers" value={truck.assignedTrailerNumbers.map((number) => trailerLabels[number] ?? number).join(", ") || "None"} /></div><div className="mt-3"><SelectInput label="Change Status" value={truck.status} options={["Available", "In Use", "Maintenance", "Unavailable"]} onChange={(value) => onStatusChange(truck.id, value as FleetStatus)} /></div></div>)}
      </div>
    </PageCard>
  );
}

function TrailersPage({ trailers, selectedTrailerNumber, onAdd, onEdit, onDelete, onSelect, onAttach, onStatusChange }: { trailers: TrailerRecord[]; selectedTrailerNumber: string; onAdd: () => void; onEdit: (item: TrailerRecord) => void; onDelete: (id: string) => void; onSelect: (item: TrailerRecord) => void; onAttach: (files: FileList | null, trailerNumber: string) => void; onStatusChange: (id: string, status: FleetStatus) => void }) {
  const inputRef = useRef<HTMLInputElement>(null); const [attachTarget, setAttachTarget] = useState("");
  return (
    <PageCard title="Trailer Management" eyebrow="Fleet" icon={Truck}>
      <div className="flex justify-end mb-3"><button className="primary-button" onClick={onAdd}><Plus size={18} />Add Trailer</button></div>
      <input ref={inputRef} className="hidden" type="file" multiple accept="image/jpeg,image/png,application/pdf" onChange={(event) => onAttach(event.currentTarget.files, attachTarget)} />
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {trailers.map((item) => <div key={item.id} className={`rounded-lg border bg-white p-3 ${item.number === selectedTrailerNumber ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"}`}><div className="flex items-start justify-between gap-3"><button className="min-w-0 text-left" onClick={() => onSelect(item)} disabled={["Maintenance", "Unavailable", "Retired"].includes(item.status)}><div className="truncate text-sm font-semibold text-slate-950">{item.number}</div><div className="mt-1 truncate text-xs text-slate-500">{item.type}</div></button><div className="flex shrink-0 gap-1"><IconAction title="Edit trailer" icon={PenLine} onClick={() => onEdit(item)} /><IconAction title="Attach documents" icon={Upload} onClick={() => { setAttachTarget(item.number); inputRef.current?.click(); }} /><IconAction title="Delete trailer" icon={Trash2} danger onClick={() => onDelete(item.id)} /></div></div><div className="mt-3 grid gap-1 text-xs text-slate-600"><PanelRow label="Dimensions" value={`${formatM(item.lengthM)} x ${formatM(item.widthM)} x ${formatM(item.heightM)}`} /><PanelRow label="Payload" value={formatKg(item.payloadKg)} /></div><div className="mt-3"><SelectInput label="Status" value={item.status} options={["Available", "In Use", "Maintenance", "Unavailable", "Retired"]} onChange={(value) => onStatusChange(item.id, value as FleetStatus)} /></div></div>)}
      </div>
    </PageCard>
  );
}

function FreightMasterPage({ freightItems, selectedFreightId, onSelect, onAdd, onEdit, onDelete, onAttach, onPreview }: { freightItems: any[]; selectedFreightId: string; onSelect: (id: string) => void; onAdd: () => void; onEdit: (item: any) => void; onDelete: (id: string) => void; onAttach: (files: FileList | null, freightId?: string) => void; onPreview: (attachment: FreightAttachment, title: string) => void }) {
  const [query, setQuery] = useState(""); const inputRef = useRef<HTMLInputElement>(null); const [attachTarget, setAttachTarget] = useState("");
  const filtered = freightItems.filter((item: any) => `${item.conNote} ${item.description} ${item.customerRef}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <PageCard title="Freight Master" eyebrow="Freight" icon={Boxes}>
      <div className="flex justify-end mb-3"><button className="primary-button" onClick={onAdd}><Plus size={18} />Add Freight</button></div>
      <input ref={inputRef} className="hidden" type="file" multiple accept="image/jpeg,image/png,application/pdf" onChange={(event) => onAttach(event.currentTarget.files, attachTarget)} />
      <div className="mb-3 max-w-md"><TextInput label="Search Freight" value={query} onChange={setQuery} /></div>
      <div className="grid max-h-full gap-3 overflow-auto lg:grid-cols-2 xl:grid-cols-3">
        {filtered.map((item: any) => <div key={item.id} className={`rounded-lg border bg-white p-3 ${item.id === selectedFreightId ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"}`}><div className="flex items-start justify-between gap-3"><button className="min-w-0 text-left" onClick={() => onSelect(item.id)}><div className="truncate text-sm font-semibold text-slate-950">{item.conNote}</div><div className="mt-1 truncate text-xs text-slate-500">{item.description}</div></button><div className="flex shrink-0 gap-1"><IconAction title="Edit freight" icon={PenLine} onClick={() => onEdit(item)} /><IconAction title="Upload attachment" icon={Upload} onClick={() => { setAttachTarget(item.id); inputRef.current?.click(); }} /><IconAction title="Delete freight" icon={Trash2} danger onClick={() => onDelete(item.id)} /></div></div><div className="mt-3 grid gap-1 text-xs text-slate-600"><div className="truncate">{item.freightType}</div><div className="truncate">{formatM(item.lengthM)} x {formatM(item.widthM)} x {formatM(item.heightM)}</div><div className="truncate">{formatKg(item.weightKg)} | {item.palletCount} pallets | {item.status}</div></div><AttachmentPreview attachments={item.attachments} compact onPreview={(attachment) => onPreview(attachment, item.conNote)} /></div>)}
      </div>
    </PageCard>
  );
}

function CustomersPage({ customers, selectedCustomer, onAdd, onEdit, onDelete, onSelect }: { customers: CustomerRecord[]; selectedCustomer: string; onAdd: () => void; onEdit: (item: CustomerRecord) => void; onDelete: (id: string) => void; onSelect: (item: CustomerRecord) => void }) {
  const [query, setQuery] = useState(""); const filtered = customers.filter((item) => `${item.name} ${item.contactPerson} ${item.email}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <PageCard title="Customer Management" eyebrow="Customers" icon={Users}>
      <div className="flex justify-end mb-3"><button className="primary-button" onClick={onAdd}><Plus size={18} />Add Customer</button></div>
      <div className="mb-3 max-w-md"><TextInput label="Search Customer" value={query} onChange={setQuery} /></div>
      <div className="grid max-h-full gap-3 overflow-auto lg:grid-cols-2 xl:grid-cols-3">
        {filtered.map((item) => <RecordCard key={item.id} active={item.name === selectedCustomer} title={item.name} subtitle={item.contactPerson} rows={[item.email, item.phone, `${item.defaultOrigin} to ${item.defaultDestination}`]} onSelect={() => onSelect(item)} onEdit={() => onEdit(item)} onDelete={() => onDelete(item.id)} />)}
      </div>
    </PageCard>
  );
}

function ReportsPage({ reports, onPreview, onDownload, onSend, onComplete }: { reports: GeneratedReport[]; onPreview: (item: GeneratedReport) => void; onDownload: (id: string) => void; onSend: (id: string) => void; onComplete: () => void }) {
  return (
    <PageCard title="Reports" eyebrow="Documents" icon={BarChart3}>
      <div className="flex justify-end mb-3"><button className="primary-button" onClick={onComplete}><CheckCircle2 size={18} />Complete Load</button></div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4"><DashboardMetric label="Generated Reports" value={String(reports.length)} /><DashboardMetric label="Pending Customer Copies" value={String(reports.filter((item) => !item.sent).length)} /><DashboardMetric label="Downloaded PDFs" value={String(reports.filter((item) => item.downloaded).length)} /><DashboardMetric label="Reports for Review" value={String(reports.filter((item) => item.status === "Requires Review").length)} /></div>
      <div className="mt-3 grid max-h-full gap-3 overflow-auto lg:grid-cols-2 xl:grid-cols-3">{reports.map((item) => <ReportCard key={item.id} report={item} onPreview={() => onPreview(item)} onDownload={() => onDownload(item.id)} onSend={() => onSend(item.id)} />)}</div>
    </PageCard>
  );
}

function SettingsPage({ settings, onChange }: { settings: SettingsState; onChange: (settings: SettingsState) => void }) {
  const setValue = <K extends keyof SettingsState>(field: K, value: SettingsState[K]) => onChange({ ...settings, [field]: value });
  return (
    <PageCard title="Settings" eyebrow="Configuration" icon={Settings}>
      <div className="grid max-h-full gap-3 overflow-auto xl:grid-cols-3">
        <SettingsSection title="Company Profile"><TextInput label="Company Name" value={settings.companyName} onChange={(value) => setValue("companyName", value)} /><TextInput label="ABN placeholder" value={settings.abn} onChange={(value) => setValue("abn", value)} /><TextInput label="Support Email" value={settings.supportEmail} onChange={(value) => setValue("supportEmail", value)} /><TextInput label="Operations Email" value={settings.operationsEmail} onChange={(value) => setValue("operationsEmail", value)} /></SettingsSection>
        <SettingsSection title="Branding"><TextInput label="Primary Colour" type="color" value={settings.primaryColour} onChange={(value) => setValue("primaryColour", value)} /><TextInput label="Secondary Colour" type="color" value={settings.secondaryColour} onChange={(value) => setValue("secondaryColour", value)} /><div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">Logo Placeholder</div></SettingsSection>
        <SettingsSection title="Trailer Defaults"><SelectInput label="Default Truck Type" value={settings.defaultTruckType} options={truckTypes} onChange={(value) => setValue("defaultTruckType", value)} /><SelectInput label="Default Trailer Type" value={settings.defaultTrailerType} options={trailerTypes} onChange={(value) => setValue("defaultTrailerType", value)} /><NumberInput label="Default Payload Warning %" value={settings.payloadWarningPercent} onChange={(value) => setValue("payloadWarningPercent", Number(value))} /></SettingsSection>
        <SettingsSection title="Notification Settings"><Toggle label="Send customer copy after completion" checked={settings.sendCustomerCopy} onChange={(value) => setValue("sendCustomerCopy", value)} /><Toggle label="Notify admin on exception" checked={settings.notifyAdminException} onChange={(value) => setValue("notifyAdminException", value)} /><Toggle label="Notify driver before departure" checked={settings.notifyDriverBeforeDeparture} onChange={(value) => setValue("notifyDriverBeforeDeparture", value)} /></SettingsSection>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 xl:col-span-2"><div className="text-sm font-semibold text-slate-950">Security Placeholder</div><p className="mt-2 text-sm leading-6 text-slate-600">Microsoft Entra ID, RBAC, Key Vault and audit logging will be connected in the Azure backend phase.</p></div>
      </div>
    </PageCard>
  );
}

function LoadIQPage({ readiness, onUpload, onPreview }: { readiness: AiPlanningReadiness; onUpload: (files: FileList | null) => void; onPreview: (attachment: FreightAttachment) => void }) {
  const fileRef = useRef<HTMLInputElement>(null); const prompts = ["Which trailer has the best fit for this freight?", "Show loads with warnings today.", "Summarise this load for the customer.", "Check if this freight may exceed trailer height."];
  const readinessItems = [["Trailer recommendation", readiness.trailerRecommendation], ["Truck recommendation", readiness.truckRecommendation], ["Load sequencing", readiness.loadSequencing], ["Weight distribution", readiness.weightDistribution], ["Compliance checks", readiness.complianceChecks], ["Space optimisation", readiness.spaceOptimisation]];
  return (
    <PageCard title="LoadIQ Assistant" eyebrow="Future AI" icon={Sparkles}>
      <input ref={fileRef} className="hidden" type="file" multiple accept=".pdf,.xls,.xlsx,.csv,image/png,image/jpeg" onChange={(event) => onUpload(event.currentTarget.files)} />
      <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[320px_minmax(0,1fr)]"><div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-semibold text-slate-950">Example prompts</div><div className="mt-3 grid gap-2">{prompts.map((prompt) => <button key={prompt} className="rounded-lg border border-slate-200 bg-white p-3 text-left text-sm text-slate-700 hover:border-blue-200 hover:bg-blue-50">{prompt}</button>)}</div></div><div className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white p-4"><div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-blue-600 text-white"><MessageCircle size={20} /></div><div><div className="text-sm font-semibold text-slate-950">LoadIQ</div><div className="text-xs text-slate-500">AI planning workspace prepared for future integration</div></div></div><button className="secondary-button" onClick={() => fileRef.current?.click()}><Upload size={18} />Upload</button></div><div className="rounded-lg bg-blue-50 p-4 text-sm leading-6 text-blue-900 ring-1 ring-blue-100">Upload load documents now. AI processing will be connected in a later integration phase.</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{readinessItems.map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="text-xs font-semibold uppercase text-slate-500">{label}</div><div className="mt-1 text-sm text-slate-700">{value}</div></div>)}</div><AttachmentPreview attachments={readiness.attachments} onPreview={onPreview} /><div className="mt-auto flex gap-2 pt-4"><input className="h-10 flex-1 rounded-md border border-slate-200 px-3 text-sm" placeholder="Ask LoadIQ..." disabled /><button className="primary-button" disabled>Send</button></div></div></div>
    </PageCard>
  );
}

function DriverSchedulePage() {
  type ScheduleView = "Today" | "7 Days" | "14 Days" | "Month";
  const msPerDay = 24 * 60 * 60 * 1000;
  const [scheduleItems, setScheduleItems] = useState<any[]>([]);
  const [lookups, setLookups] = useState<any>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [scheduleView, setScheduleView] = useState<ScheduleView>("7 Days");
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [driverFilter, setDriverFilter] = useState("All");
  const [truckFilter, setTruckFilter] = useState("All");
  const [activeCell, setActiveCell] = useState<{ driverName: string; dateIndex: number } | null>(null);
  const [cellEdits, setCellEdits] = useState<Record<string, { scheduleDetails: string; truck: string }>>({});
  const [cellSaving, setCellSaving] = useState<Record<string, boolean>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [cellSuccess, setCellSuccess] = useState<Record<string, string>>({});
  const [driverRows, setDriverRows] = useState<string[]>([]);
  const [newDriverName, setNewDriverName] = useState("");

  const selectedStart = new Date(`${dateRange}T00:00:00`);
  const viewDays = scheduleView === "Today" ? 1 : scheduleView === "7 Days" ? 7 : scheduleView === "14 Days" ? 14 : new Date(selectedStart.getFullYear(), selectedStart.getMonth() + 1, 0).getDate();
  const selectedEnd = new Date(selectedStart.getTime() + viewDays * msPerDay);

  const formatTimelineDate = (date: Date) => date.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
  const timeline = Array.from({ length: viewDays }, (_, index) => formatTimelineDate(new Date(selectedStart.getTime() + index * msPerDay)));

  const fromApiItem = (item: any) => ({
    id: item.id,
    driver: item.driver?.displayName ?? "Unassigned",
    truck: item.truck?.truckNumber ?? "",
    trailer: item.trailer?.trailerNumber ?? "",
    loadPlan: item.loadPlanNumber ?? "",
    customer: item.customerName ?? "",
    pickup: item.pickupLocation ?? "",
    delivery: item.deliveryLocation ?? "",
    startDateTime: item.startDateTimeUtc,
    endDateTime: item.endDateTimeUtc,
    status: item.status,
    conNote: item.conNote ?? "",
    notes: item.notes ?? "",
    apiBacked: true
  });

  const loadApiData = async () => {
    setApiLoading(true);
    setApiError("");
    try {
      const [nextLookups, nextSchedules] = await Promise.all([
        fetchDriverScheduleLookups(),
        fetchDriverSchedules(selectedStart.toISOString(), selectedEnd.toISOString())
      ]);
      setLookups(nextLookups);
      const items = nextSchedules.map(fromApiItem);
      setScheduleItems(items);
      const driverSet = new Set<string>();
      items.forEach((item: any) => {
        if (item.driver) driverSet.add(item.driver);
      });
      driverRows.forEach((d) => driverSet.add(d));
      setDriverRows(Array.from(driverSet).sort());
    } catch (error) {
      setScheduleItems([]);
      setApiError(error instanceof Error ? error.message : "Driver Schedule is not available right now. Please try again.");
    } finally {
      setApiLoading(false);
    }
  };

  useEffect(() => {
    void loadApiData();
  }, [dateRange, scheduleView]);

  const driverOptions = Array.from(new Set([
    ...(lookups?.drivers?.map((row: any) => row.displayName ?? "") ?? []),
    ...driverRows
  ].filter(Boolean))).sort((a: string, b: string) => a.localeCompare(b));

  const truckOptions = Array.from(new Set([
    ...(lookups?.trucks?.map((row: any) => row.truckNumber ?? "") ?? []),
    ...scheduleItems.map((item: any) => item.truck).filter(Boolean)
  ])).filter(Boolean).sort((a: string, b: string) => a.localeCompare(b));

  const getScheduleForCell = (driverName: string, dateIndex: number) => {
    const cellDate = new Date(selectedStart.getTime() + dateIndex * msPerDay);
    const cellDateStr = cellDate.toLocaleDateString("en-CA");
    return scheduleItems.find((item: any) => {
      const itemDate = new Date(item.startDateTime);
      const itemDateStr = itemDate.toLocaleDateString("en-CA");
      return item.driver === driverName && itemDateStr === cellDateStr;
    }) || null;
  };

  const getCellKey = (driverName: string, dateIndex: number) => {
    const cellDate = new Date(selectedStart.getTime() + dateIndex * msPerDay);
    return `${driverName}|${cellDate.toLocaleDateString("en-CA")}`;
  };

  const isActive = (driverName: string, dateIndex: number) => 
    activeCell?.driverName === driverName && activeCell?.dateIndex === dateIndex;

  const openCell = (driverName: string, dateIndex: number) => {
    const schedule = getScheduleForCell(driverName, dateIndex);
    const key = getCellKey(driverName, dateIndex);
    setActiveCell({ driverName, dateIndex });
    if (!cellEdits[key]) {
      setCellEdits((prev) => ({
        ...prev,
        [key]: {
          scheduleDetails: schedule ? (schedule.loadPlan || schedule.notes || schedule.status || "") : "",
          truck: schedule ? schedule.truck : ""
        }
      }));
    }
    setCellErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setCellSuccess((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const closeCell = () => {
    setActiveCell(null);
  };

  const getCellEdit = (driverName: string, dateIndex: number) => {
    const key = getCellKey(driverName, dateIndex);
    if (cellEdits[key]) return cellEdits[key];
    const schedule = getScheduleForCell(driverName, dateIndex);
    return {
      scheduleDetails: schedule ? (schedule.loadPlan || schedule.notes || schedule.status || "") : "",
      truck: schedule ? schedule.truck : ""
    };
  };

  const updateCellEdit = (driverName: string, dateIndex: number, field: "scheduleDetails" | "truck", value: string) => {
    const key = getCellKey(driverName, dateIndex);
    const current = getCellEdit(driverName, dateIndex);
    setCellEdits((prev) => ({
      ...prev,
      [key]: { ...current, [field]: value }
    }));
    setCellErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setCellSuccess((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const saveCell = async (driverName: string, dateIndex: number) => {
    const key = getCellKey(driverName, dateIndex);
    if (cellSaving[key]) return;
    const cellDate = new Date(selectedStart.getTime() + dateIndex * msPerDay);
    const dateStr = cellDate.toLocaleDateString("en-CA");
    const edit = getCellEdit(driverName, dateIndex);
    if (!driverName.trim()) {
      setCellErrors((prev) => ({ ...prev, [key]: "Driver name is required." }));
      return;
    }
    setCellSaving((prev) => ({ ...prev, [key]: true }));
    setCellErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setCellSuccess((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const existingSchedule = getScheduleForCell(driverName, dateIndex);
      const payload: DriverSchedulePayload = {
        driverId: undefined,
        driverName: driverName.trim(),
        truckId: null,
        truckNumber: edit.truck.trim() || null,
        trailerId: null,
        trailerNumber: null,
        loadPlanNumber: edit.scheduleDetails.trim() || null,
        customerName: null,
        pickupLocation: null,
        deliveryLocation: null,
        startDateTimeUtc: new Date(`${dateStr}T08:00:00`).toISOString(),
        endDateTimeUtc: new Date(`${dateStr}T17:00:00`).toISOString(),
        status: "Scheduled" as DriverScheduleStatus,
        conNote: null,
        notes: edit.scheduleDetails.trim() || null
      };
      if (existingSchedule?.apiBacked) {
        await updateDriverSchedule(existingSchedule.id, payload);
      } else {
        await createDriverSchedule(payload);
      }
      setCellEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await loadApiData();
      setCellSuccess((prev) => ({ ...prev, [key]: "Saved" }));
      setTimeout(() => {
        setCellSuccess((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 2000);
      closeCell();
    } catch (error) {
      setCellErrors((prev) => ({
        ...prev,
        [key]: error instanceof Error ? error.message : "Save failed"
      }));
    } finally {
      setCellSaving((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const deleteCell = async (driverName: string, dateIndex: number) => {
    const key = getCellKey(driverName, dateIndex);
    const existingSchedule = getScheduleForCell(driverName, dateIndex);
    if (!existingSchedule?.apiBacked) return;
    if (!window.confirm("Delete this schedule?")) return;
    setCellSaving((prev) => ({ ...prev, [key]: true }));
    try {
      await deleteDriverScheduleFromApi(existingSchedule.id);
      setCellEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await loadApiData();
      closeCell();
    } catch (error) {
      setCellErrors((prev) => ({
        ...prev,
        [key]: error instanceof Error ? error.message : "Delete failed"
      }));
    } finally {
      setCellSaving((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const addDriverRow = () => {
    const name = newDriverName.trim();
    if (!name) return;
    if (driverRows.includes(name)) {
      setNewDriverName("");
      return;
    }
    setDriverRows((prev) => [...prev, name].sort());
    setNewDriverName("");
  };

  const filteredDriverRows = driverRows.filter((driverName) => {
    if (driverFilter !== "All" && driverName !== driverFilter) return false;
    if (truckFilter !== "All") {
      const hasMatchingTruck = scheduleItems.some((item: any) => item.driver === driverName && item.truck === truckFilter);
      if (!hasMatchingTruck) return false;
    }
    return true;
  });

  return (
    <PageCard title="Driver Schedule" eyebrow="Operations" icon={MapPin}>
      <div className="grid h-full min-h-0 gap-3 overflow-auto pr-1">
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
          apiError ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"
        }`}>
          <span>{apiError || (apiLoading ? "Connecting to live Azure Driver Schedule..." : "Azure Live connected.")}</span>
          {apiError && apiError.toLowerCase().includes("sign in") && (
            <a className="font-semibold text-blue-700 underline" href={getDriverScheduleLoginUrl()}>Sign in again</a>
          )}
        </div>
        <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 xl:grid-cols-[190px_220px_1fr_1fr_auto]">
          <TextInput label="Date range start" type="date" value={dateRange} onChange={setDateRange} />
          <div>
            <div className="mb-1 text-xs font-medium text-slate-500">View</div>
            <div className="grid grid-cols-4 rounded-md bg-white p-1 ring-1 ring-slate-200">
              {(["Today", "7 Days", "14 Days", "Month"] as ScheduleView[]).map((label) => (
                <button
                  key={label}
                  onClick={() => setScheduleView(label)}
                  className={`rounded px-2 py-2 text-xs font-semibold ${
                    scheduleView === label ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-blue-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <SelectInput label="Driver" value={driverFilter} options={["All", ...driverOptions]} onChange={setDriverFilter} />
          <SelectInput label="Truck" value={truckFilter} options={["All", ...truckOptions]} onChange={setTruckFilter} />
          <button className="secondary-button self-end justify-center" onClick={() => { setDriverFilter("All"); setTruckFilter("All"); }}>
            Reset
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <span className="text-sm font-semibold text-slate-700">Add Driver Row:</span>
          <input
            className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            placeholder="Enter driver name..."
            value={newDriverName}
            onChange={(e) => setNewDriverName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addDriverRow(); }}
            list="driver-suggestions"
          />
          <datalist id="driver-suggestions">
            {driverOptions.filter((d: string) => d !== "All").map((d: string) => <option key={d} value={d} />)}
          </datalist>
          <button className="primary-button" onClick={addDriverRow}>
            <Plus size={18} />Add
          </button>
        </div>
        <div className="min-h-[430px] overflow-auto rounded-lg border border-slate-200 bg-white">
          <div className="min-w-[1040px]">
            <div className="grid grid-cols-[260px_minmax(760px,1fr)] border-b border-slate-200 bg-slate-50 sticky top-0 z-10">
              <div className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 p-3 text-xs font-semibold uppercase text-slate-500">
                Driver
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${viewDays}, minmax(140px, 1fr))` }}>
                {timeline.map((label) => (
                  <div key={label} className="border-r border-slate-200 p-3 text-center text-xs font-semibold text-slate-600">
                    {label}
                  </div>
                ))}
              </div>
            </div>
            {filteredDriverRows.map((driverName) => (
              <div key={driverName} className="grid min-h-[80px] grid-cols-[260px_minmax(760px,1fr)] border-b border-slate-100">
                <div className="sticky left-0 z-10 border-r border-slate-200 bg-white p-3 flex items-center">
                  <div className="text-sm font-semibold text-slate-950">{driverName}</div>
                </div>
                <div className="grid" style={{ gridTemplateColumns: `repeat(${viewDays}, minmax(140px, 1fr))` }}>
                  {Array.from({ length: viewDays }, (_, dateIndex) => {
                    const key = getCellKey(driverName, dateIndex);
                    const edit = getCellEdit(driverName, dateIndex);
                    const saving = cellSaving[key] || false;
                    const error = cellErrors[key] || "";
                    const success = cellSuccess[key] || "";
                    const existingSchedule = getScheduleForCell(driverName, dateIndex);
                    const active = isActive(driverName, dateIndex);
                    const hasSchedule = Boolean(existingSchedule?.apiBacked);

                    if (active) {
                      return (
                        <div key={dateIndex} className="border-r border-slate-200 p-2 flex flex-col gap-2 min-h-[140px] bg-blue-50/30 ring-2 ring-blue-300 ring-inset">
                          <div className="flex-1 flex flex-col">
                            <textarea
                              className="flex-1 w-full rounded-md border border-blue-300 bg-white px-2 py-1 text-xs outline-none resize-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                              placeholder="Schedule / job details..."
                              value={edit.scheduleDetails}
                              onChange={(e) => updateCellEdit(driverName, dateIndex, "scheduleDetails", e.target.value)}
                              disabled={saving}
                              rows={2}
                            />
                          </div>
                          <div className="border-t border-blue-200"></div>
                          <div className="flex flex-col gap-1">
                            <input
                              className="h-8 w-full rounded-md border border-blue-300 bg-white px-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                              placeholder="Truck..."
                              value={edit.truck}
                              onChange={(e) => updateCellEdit(driverName, dateIndex, "truck", e.target.value)}
                              disabled={saving}
                              list={`truck-suggestions-${dateIndex}`}
                            />
                            <datalist id={`truck-suggestions-${dateIndex}`}>
                              {truckOptions.filter((t: string) => t !== "All").map((t: string) => <option key={t} value={t} />)}
                            </datalist>
                            <div className="flex gap-1">
                              <button
                                className="flex-1 h-7 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-1"
                                onClick={() => saveCell(driverName, dateIndex)}
                                disabled={saving}
                              >
                                {saving ? "Saving..." : existingSchedule?.apiBacked ? "Update" : "Save"}
                              </button>
                              <button
                                className="h-7 px-2 rounded-md border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 transition flex items-center justify-center"
                                onClick={closeCell}
                                disabled={saving}
                              >
                                Cancel
                              </button>
                              {existingSchedule?.apiBacked && (
                                <button
                                  className="h-7 w-7 rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 transition flex items-center justify-center"
                                  onClick={() => deleteCell(driverName, dateIndex)}
                                  disabled={saving}
                                  title="Delete schedule"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                            {error && <div className="text-[10px] font-medium text-red-600">{error}</div>}
                            {success && <div className="text-[10px] font-medium text-emerald-600">{success}</div>}
                          </div>
                        </div>
                      );
                    }

                    if (hasSchedule) {
                      return (
                        <div
                          key={dateIndex}
                          className="border-r border-slate-200 p-2 min-h-[80px] cursor-pointer hover:bg-blue-50/50 transition flex flex-col"
                          onClick={() => openCell(driverName, dateIndex)}
                          title="Click to edit"
                        >
                          <div className="flex-1 flex flex-col justify-center">
                            <div className="text-xs font-semibold text-slate-800 leading-tight">
                              {existingSchedule.loadPlan || existingSchedule.notes || existingSchedule.status}
                            </div>
                            {existingSchedule.truck && (
                              <div className="text-[11px] text-slate-500 mt-1">Truck: {existingSchedule.truck}</div>
                            )}
                          </div>
                          {success && <div className="text-[10px] font-medium text-emerald-600 mt-1">{success}</div>}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={dateIndex}
                        className="border-r border-slate-200 p-2 min-h-[80px] cursor-pointer hover:bg-blue-50/50 transition"
                        onClick={() => openCell(driverName, dateIndex)}
                        title="Click to add schedule"
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            {filteredDriverRows.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-500">
                {driverRows.length === 0 ? "Add a driver row above to get started." : "No drivers match the current filters."}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageCard>
  );
}

function Sidebar({ activePage, onPageChange }: { activePage: SidebarPage; onPageChange: (page: SidebarPage) => void }) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-white/10 bg-[#050a14] text-white lg:flex lg:flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-blue-600"><Truck size={21} /></div>
        <div className="min-w-0"><div className="truncate text-base font-semibold">LoadLogix</div><div className="truncate text-xs text-slate-400">ELX Smart Planner</div></div>
      </div>
      <nav className="space-y-1 px-3 py-3">
        {sidebarItems.map((item) => { const Icon = item.icon; return <button key={item.label} onClick={() => onPageChange(item.label)} className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition ${activePage === item.label ? "bg-blue-600 text-white shadow-lg shadow-blue-950/30" : "text-slate-300 hover:bg-white/8 hover:text-white"}`}><Icon size={18} /><span>{item.label}</span></button>; })}
      </nav>
      <div className="mt-auto border-t border-white/10 p-3">
        <button onClick={() => onPageChange("LoadIQ Assistant")} className={`mb-3 flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition ${activePage === "LoadIQ Assistant" ? "bg-blue-600 text-white" : "bg-white/8 text-blue-100 hover:bg-white/12"}`}><Sparkles size={18} /><span>LoadIQ Assistant</span></button>
        <div className="rounded-lg bg-white/8 p-3"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-blue-600/20 text-blue-200"><Warehouse size={17} /></div><div className="min-w-0"><div className="truncate text-sm font-semibold">Admin User</div><div className="truncate text-xs text-slate-400">admin@elxlogistics.com</div></div></div></div>
      </div>
    </aside>
  );
}

function MobileTopBar({ onLoadPlans }: { onLoadPlans: () => void }) {
  return (
    <div className="flex h-14 items-center justify-between rounded-lg bg-[#050a14] px-3 text-white lg:hidden">
      <button className="flex min-w-0 items-center gap-3 text-left" onClick={onLoadPlans}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-blue-600"><Truck size={20} /></div><div className="min-w-0"><div className="truncate text-sm font-semibold">ELX Smart Load Planner</div><div className="truncate text-xs text-slate-400">Digital Trailer Twin</div></div></button>
      <button className="grid h-9 w-9 place-items-center rounded-md border border-white/15" title="Open menu"><Menu size={19} /></button>
    </div>
  );
}

// ============================================================
// EXPORT
// ============================================================
export default App;