import NextImage from 'next/image';

const Foo = () => {
  return (
    <>
      <NextImage src="/good.png" alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element -- EXPECTED */}
      <img src="/bad.png" alt="" />
    </>
  );
};

export default Foo;
