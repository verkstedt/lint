import { useEffect } from 'react';

const Foo = ({ foo }) => {
  useEffect(() => {
    alert(foo);
  }, [foo]);

  useEffect(
    () => {
      alert(foo);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- EXPECTED
    [],
  );

  return <>{foo}</>;
};

export default Foo;
