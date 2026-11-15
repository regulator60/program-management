import { S0View } from "./view";

export const metadata = { title: "S0 weekly review" };

export default function Page() {
  return <S0View scope={Promise.resolve(null)} />;
}
