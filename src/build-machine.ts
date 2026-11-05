import { selectOption } from "./prompt"
import { terminal } from "./terminal"
export const buildMachineIds = ["2cpu", "4cpu", "8cpu", "16cpu"] as const
export type BuildMachineId = typeof buildMachineIds[number]
export type BuildMachineChoice = BuildMachineId | "select"
export const defaultBuildMachine: BuildMachineId = "4cpu"
const machineAliases: Record<string, BuildMachineId> = { "2c2g": "2cpu", "4c4g": "4cpu", "8c8g": "8cpu", "16c16g": "16cpu", "16c,16g": "16cpu",
  "2cpu": "2cpu", "4cpu": "4cpu", "8cpu": "8cpu", "16cpu": "16cpu" }
export function parseBuildMachine(value: string): BuildMachineId | undefined {
  const alias = value.toLowerCase()
  return Object.hasOwn(machineAliases, alias) ? machineAliases[alias] : undefined
}
export async function selectBuildMachine(machine?: BuildMachineChoice): Promise<BuildMachineId> {
  if (machine !== "select") return machine || defaultBuildMachine
  const options = [
    { value: "4cpu", label: "4 vCPU / 4 GiB · 1× seconds · $0.00025/s overage (default)" },
    { value: "2cpu", label: "2 vCPU / 2 GiB · 0.5× seconds · $0.000125/s overage" },
    { value: "8cpu", label: "8 vCPU / 8 GiB · 2× seconds · $0.0005/s overage" },
    { value: "16cpu", label: "16 vCPU / 16 GiB · 4× seconds · $0.001/s overage" },
  ] as const
  return selectOption("Build machine:", options.map(option => ({ ...option,
    label: terminal.unicode ? option.label : option.label.replaceAll("·", "|").replaceAll("×", "x"),
  })))
}
