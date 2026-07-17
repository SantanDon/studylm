import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBookOpen } from "@fortawesome/free-solid-svg-icons";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const Logo = ({ size = "md", className = "" }: LogoProps) => {
  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-12 h-12",
  };

  const iconSizes = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-xl",
  };

  return (
    <div
      className={`${sizeClasses[size]} bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center shadow-md ${className}`}
    >
      <FontAwesomeIcon
        icon={faBookOpen}
        className={`${iconSizes[size]} text-white`}
      />
    </div>
  );
};

export default Logo;
