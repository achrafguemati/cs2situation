const MaskedIcon = ({ path, height, color, title }) => {
  return (
    <div
      className={`${color}`}
      title={title}
      style={{
        WebkitMask: `url(${path}) no-repeat center / contain`,
        width: `auto`,
        height: height,
      }}
    >
      <img className="w-full h-full opacity-0" src={path} alt=""></img>
    </div>
  );
};

export default MaskedIcon;