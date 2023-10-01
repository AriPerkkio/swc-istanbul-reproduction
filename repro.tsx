type Props = {
  total: number;
};

const NotCovered = ({ total = 0 }: Props) => (
  <>
    {total === 0 && <div>total is zero</div>}

    {total !== 0 && <div>total is not zero</div>}
  </>
);

export default NotCovered;
